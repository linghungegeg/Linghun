use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const QUERY_TIMEOUT: Duration = Duration::from_millis(60000);

pub struct PhpDeepLayer {
    child: Child,
    stdin: ChildStdin,
    stdout: Arc<Mutex<BufReader<ChildStdout>>>,
    root: PathBuf,
}

pub struct PhpDeepLayerResult {
    pub issues: Vec<Value>,
    pub status: &'static str,
    pub reason: Option<String>,
    pub elapsed_ms: u128,
}

fn normalize_status(status: &str) -> &'static str {
    match status {
        "clean" | "php_error" => "active",
        "fallback" | "fallback_used" => "fallback_used",
        "unavailable" | "tool_missing" => "tool_missing",
        "error" => "error",
        _ => "error",
    }
}

fn find_script(root: &Path) -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        let candidate = exe.parent()?.join("php-deep-layer.cjs");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    let candidates = [
        PathBuf::from("php-deep-layer.cjs"),
        root.join("php-deep-layer.cjs"),
    ];
    for c in &candidates {
        if c.exists() {
            return Some(c.clone());
        }
    }
    None
}

impl PhpDeepLayer {
    pub fn try_init(root: &Path) -> Result<Self, String> {
        let script = find_script(root)
            .ok_or_else(|| "php-deep-layer.cjs not found".to_string())?;

        let mut child = Command::new("node")
            .arg(&script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("node spawn failed: {e}"))?;

        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout = Arc::new(Mutex::new(BufReader::new(child.stdout.take().ok_or("no stdout")?)));

        Ok(PhpDeepLayer { child, stdin, stdout, root: root.to_path_buf() })
    }

    fn query(&mut self, root: &Path, files: &[String]) -> Result<Value, String> {
        let req = json!({ "root": root.to_string_lossy(), "files": files });
        let mut line = req.to_string();
        line.push('\n');
        self.stdin.write_all(line.as_bytes()).map_err(|e| format!("write: {e}"))?;
        self.stdin.flush().map_err(|e| format!("flush: {e}"))?;

        let stdout = Arc::clone(&self.stdout);
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut buf = String::new();
            let mut locked = stdout.lock().unwrap();
            if locked.read_line(&mut buf).unwrap_or(0) > 0 {
                let _ = tx.send(Ok(buf));
            } else {
                let _ = tx.send(Err("empty response".to_string()));
            }
        });

        let response = rx.recv_timeout(QUERY_TIMEOUT)
            .map_err(|_| "timeout waiting for php-deep-layer response".to_string())?
            .map_err(|e| e)?;

        serde_json::from_str(&response).map_err(|e| format!("parse: {e}"))
    }
}

pub fn run(layer: &mut Option<PhpDeepLayer>, root: &Path, files: &[String]) -> PhpDeepLayerResult {
    let start = Instant::now();

    if layer.is_none() {
        match PhpDeepLayer::try_init(root) {
            Ok(l) => *layer = Some(l),
            Err(reason) => {
                return PhpDeepLayerResult {
                    issues: vec![],
                    status: "unavailable",
                    reason: Some(reason),
                    elapsed_ms: start.elapsed().as_millis(),
                };
            }
        }
    }

    let l = layer.as_mut().unwrap();
    match l.query(root, files) {
        Ok(val) => {
            let issues = val.get("issues")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let status_str = val.get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("active");
            let reason = val.get("reason")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| val.get("error").and_then(|v| v.as_str()).map(|s| s.to_string()));
            let fallback = val.get("fallback")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let final_status = normalize_status(status_str);

            PhpDeepLayerResult {
                issues,
                status: final_status,
                reason: reason.or(fallback),
                elapsed_ms: start.elapsed().as_millis(),
            }
        }
        Err(reason) => {
            *layer = None;
            PhpDeepLayerResult {
                issues: vec![],
                status: "unavailable",
                reason: Some(reason),
                elapsed_ms: start.elapsed().as_millis(),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_status;

    #[test]
    fn normalizes_only_explicit_php_success_as_active() {
        assert_eq!(normalize_status("clean"), "active");
        assert_eq!(normalize_status("php_error"), "active");
        assert_eq!(normalize_status("fallback_used"), "fallback_used");
        assert_eq!(normalize_status("tool_missing"), "tool_missing");
        assert_eq!(normalize_status("error"), "error");
        assert_eq!(normalize_status("unknown"), "error");
    }
}
