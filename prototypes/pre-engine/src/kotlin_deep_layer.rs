use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const QUERY_TIMEOUT: Duration = Duration::from_millis(60000);

pub struct KotlinDeepLayer {
    child: Child,
    stdin: ChildStdin,
    stdout: Arc<Mutex<BufReader<ChildStdout>>>,
    root: PathBuf,
}

pub struct KotlinDeepLayerResult {
    pub issues: Vec<Value>,
    pub status: &'static str,
    pub reason: Option<String>,
    pub elapsed_ms: u128,
}

fn find_script(root: &Path) -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        let candidate = exe.parent()?.join("kotlin-deep-layer.cjs");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    let candidates = [
        PathBuf::from("kotlin-deep-layer.cjs"),
        root.join("kotlin-deep-layer.cjs"),
    ];
    for c in &candidates {
        if c.exists() {
            return Some(c.clone());
        }
    }
    None
}

impl KotlinDeepLayer {
    pub fn try_init(root: &Path) -> Result<Self, String> {
        let script = find_script(root)
            .ok_or_else(|| "kotlin-deep-layer.cjs not found".to_string())?;

        let mut child = Command::new("node")
            .arg(&script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("node spawn failed: {e}"))?;

        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout = Arc::new(Mutex::new(BufReader::new(child.stdout.take().ok_or("no stdout")?)));

        Ok(KotlinDeepLayer { child, stdin, stdout, root: root.to_path_buf() })
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
            .map_err(|_| "timeout waiting for kotlin-deep-layer response".to_string())?
            .map_err(|e| e)?;

        serde_json::from_str(&response).map_err(|e| format!("parse: {e}"))
    }
}

fn map_helper_status(status: &str, has_issues: bool) -> &'static str {
    match status {
        "clean" if !has_issues => "active",
        "kotlin_error" if has_issues => "active",
        "tool_missing" | "unavailable" => "tool_missing",
        _ => "partially_verified",
    }
}

pub fn run(layer: &mut Option<KotlinDeepLayer>, root: &Path, files: &[String]) -> KotlinDeepLayerResult {
    let start = Instant::now();

    if layer.is_none() {
        match KotlinDeepLayer::try_init(root) {
            Ok(l) => *layer = Some(l),
            Err(reason) => {
                return KotlinDeepLayerResult {
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
                .unwrap_or("missing");
            let helper_reason = val.get("reason")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let helper_error = val.get("error")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let final_status = map_helper_status(status_str, !issues.is_empty());
            let reason = if final_status == "partially_verified" {
                Some(helper_error.unwrap_or_else(|| format!("unexpected helper status: {status_str}")))
            } else {
                helper_reason.or(helper_error)
            };
            if final_status == "partially_verified" {
                *layer = None;
            }

            KotlinDeepLayerResult {
                issues,
                status: final_status,
                reason,
                elapsed_ms: start.elapsed().as_millis(),
            }
        }
        Err(reason) => {
            *layer = None;
            KotlinDeepLayerResult {
                issues: vec![],
                status: "partially_verified",
                reason: Some(reason),
                elapsed_ms: start.elapsed().as_millis(),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::map_helper_status;

    #[test]
    fn maps_only_confirmed_kotlin_results_to_active() {
        assert_eq!(map_helper_status("clean", false), "active");
        assert_eq!(map_helper_status("kotlin_error", true), "active");
        assert_eq!(map_helper_status("tool_missing", false), "tool_missing");
        assert_eq!(map_helper_status("error", false), "partially_verified");
        assert_eq!(map_helper_status("unknown", false), "partially_verified");
        assert_eq!(map_helper_status("clean", true), "partially_verified");
    }
}
