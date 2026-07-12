use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use serde_json::Value;

pub struct SqlDeepLayer {
    pub child: Child,
    pub stdin: std::process::ChildStdin,
    pub stdout: Arc<Mutex<BufReader<std::process::ChildStdout>>>,
    pub root: PathBuf,
}

pub struct SqlDeepLayerResult {
    pub issues: Vec<Value>,
    pub status: &'static str,
    pub reason: Option<String>,
    pub elapsed_ms: u128,
}

fn normalize_status(status: &str) -> &'static str {
    match status {
        "clean" | "sql_error" => "active",
        "fallback" | "fallback_used" => "fallback_used",
        "unavailable" | "tool_missing" => "tool_missing",
        "error" => "error",
        _ => "error",
    }
}

fn find_script(root: &Path) -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        let candidate = exe.parent()?.join("sql-deep-layer.cjs");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    let candidates = [
        PathBuf::from("sql-deep-layer.cjs"),
        root.join("sql-deep-layer.cjs"),
    ];
    for c in &candidates {
        if c.exists() {
            return Some(c.clone());
        }
    }
    None
}

fn try_init(root: &Path) -> Option<SqlDeepLayer> {
    let script = find_script(root)?;
    let mut child = Command::new("node")
        .arg(&script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let stdin = child.stdin.take()?;
    let stdout = child.stdout.take()?;
    Some(SqlDeepLayer {
        child,
        stdin,
        stdout: Arc::new(Mutex::new(BufReader::new(stdout))),
        root: root.to_path_buf(),
    })
}

fn query(layer: &mut SqlDeepLayer, root: &Path, files: &[String]) -> Option<Value> {
    let req = serde_json::json!({ "root": root.to_string_lossy(), "files": files });
    let mut line = req.to_string();
    line.push('\n');
    layer.stdin.write_all(line.as_bytes()).ok()?;
    layer.stdin.flush().ok()?;

    let stdout = Arc::clone(&layer.stdout);
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = String::new();
        let mut locked = stdout.lock().unwrap();
        if locked.read_line(&mut buf).unwrap_or(0) > 0 {
            let _ = tx.send(buf);
        } else {
            let _ = tx.send(String::new());
        }
    });

    let response = rx.recv_timeout(std::time::Duration::from_secs(30)).ok()?;
    if response.is_empty() {
        return None;
    }
    serde_json::from_str(&response).ok()
}

pub fn run(layer: &mut Option<SqlDeepLayer>, root: &Path, files: &[String]) -> SqlDeepLayerResult {
    let start = Instant::now();

    if layer.is_none() {
        *layer = try_init(root);
    }
    if layer.is_none() {
        return SqlDeepLayerResult {
            issues: vec![],
            status: "unavailable",
            reason: Some("sql-deep-layer.cjs not found or node spawn failed".to_string()),
            elapsed_ms: start.elapsed().as_millis(),
        };
    }

    let l = layer.as_mut().unwrap();
    let resp = query(l, root, files);

    match resp {
        Some(val) => {
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

            SqlDeepLayerResult {
                issues,
                status: final_status,
                reason: reason.or(fallback),
                elapsed_ms: start.elapsed().as_millis(),
            }
        }
        None => {
            *layer = None;
            SqlDeepLayerResult {
                issues: vec![],
                status: "unavailable",
                reason: Some("sql-deep-layer subprocess did not respond".to_string()),
                elapsed_ms: start.elapsed().as_millis(),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_status;

    #[test]
    fn normalizes_only_explicit_sql_success_as_active() {
        assert_eq!(normalize_status("clean"), "active");
        assert_eq!(normalize_status("sql_error"), "active");
        assert_eq!(normalize_status("fallback_used"), "fallback_used");
        assert_eq!(normalize_status("tool_missing"), "tool_missing");
        assert_eq!(normalize_status("error"), "error");
        assert_eq!(normalize_status("unknown"), "error");
    }
}
