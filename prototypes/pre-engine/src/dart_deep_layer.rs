use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const QUERY_TIMEOUT: Duration = Duration::from_millis(60000);

pub struct DartDeepLayer {
    child: Child,
    stdin: ChildStdin,
    stdout: Arc<Mutex<BufReader<ChildStdout>>>,
    root: PathBuf,
}

pub struct DartDeepLayerResult {
    pub issues: Vec<Value>,
    pub status: &'static str,
    pub reason: Option<String>,
    pub elapsed_ms: u128,
}

fn normalize_status(
    status: Option<&str>,
    issues_present: bool,
    has_issues: bool,
) -> (&'static str, Option<&'static str>) {
    if !issues_present {
        return ("partially_verified", Some("Dart helper response omitted issues"));
    }
    match (status, has_issues) {
        (Some("clean"), false) | (Some("dart_error"), true) => ("active", None),
        (Some("unavailable" | "tool_missing"), false) => ("tool_missing", None),
        (Some("clean"), true) => (
            "partially_verified",
            Some("Dart helper reported clean with issues"),
        ),
        (Some("dart_error"), false) => (
            "partially_verified",
            Some("Dart helper reported dart_error without issues"),
        ),
        (Some("unavailable" | "tool_missing"), true) => (
            "partially_verified",
            Some("Dart helper reported tool missing with issues"),
        ),
        (Some("error"), _) => (
            "partially_verified",
            Some("Dart helper reported an execution error"),
        ),
        (Some(_), _) => (
            "partially_verified",
            Some("Dart helper returned an unknown status"),
        ),
        (None, _) => (
            "partially_verified",
            Some("Dart helper response omitted status"),
        ),
    }
}

fn find_script(root: &Path) -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        let candidate = exe.parent()?.join("dart-deep-layer.cjs");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    let candidates = [
        PathBuf::from("dart-deep-layer.cjs"),
        root.join("dart-deep-layer.cjs"),
    ];
    for c in &candidates {
        if c.exists() {
            return Some(c.clone());
        }
    }
    None
}

impl DartDeepLayer {
    pub fn try_init(root: &Path) -> Result<Self, String> {
        let script = find_script(root)
            .ok_or_else(|| "dart-deep-layer.cjs not found".to_string())?;

        let mut child = Command::new("node")
            .arg(&script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("node spawn failed: {e}"))?;

        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout = Arc::new(Mutex::new(BufReader::new(child.stdout.take().ok_or("no stdout")?)));

        Ok(DartDeepLayer { child, stdin, stdout, root: root.to_path_buf() })
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
            .map_err(|_| "timeout waiting for dart-deep-layer response".to_string())?
            .map_err(|e| e)?;

        serde_json::from_str(&response).map_err(|e| format!("parse: {e}"))
    }
}

pub fn run(layer: &mut Option<DartDeepLayer>, root: &Path, files: &[String]) -> DartDeepLayerResult {
    let start = Instant::now();

    if layer.is_none() {
        match DartDeepLayer::try_init(root) {
            Ok(l) => *layer = Some(l),
            Err(reason) => {
                return DartDeepLayerResult {
                    issues: vec![],
                    status: "tool_missing",
                    reason: Some(reason),
                    elapsed_ms: start.elapsed().as_millis(),
                };
            }
        }
    }

    let l = layer.as_mut().unwrap();
    match l.query(root, files) {
        Ok(val) => {
            let issues_value = val.get("issues").and_then(|v| v.as_array());
            let issues = issues_value
                .cloned()
                .unwrap_or_default();
            let status = val.get("status").and_then(|v| v.as_str());
            let reason = val.get("reason")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| val.get("error").and_then(|v| v.as_str()).map(|s| s.to_string()));
            let (final_status, consistency_reason) =
                normalize_status(status, issues_value.is_some(), !issues.is_empty());
            let reason = match (consistency_reason, reason) {
                (Some(consistency), Some(reason)) => Some(format!("{consistency}: {reason}")),
                (Some(consistency), None) => Some(consistency.to_string()),
                (None, reason) => reason,
            };

            DartDeepLayerResult {
                issues,
                status: final_status,
                reason,
                elapsed_ms: start.elapsed().as_millis(),
            }
        }
        Err(reason) => {
            *layer = None;
            DartDeepLayerResult {
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
    use super::normalize_status;

    #[test]
    fn maps_only_consistent_dart_results_to_active() {
        assert_eq!(normalize_status(Some("clean"), true, false).0, "active");
        assert_eq!(normalize_status(Some("dart_error"), true, true).0, "active");
        assert_eq!(normalize_status(Some("unavailable"), true, false).0, "tool_missing");
        assert_eq!(normalize_status(Some("tool_missing"), true, false).0, "tool_missing");
    }

    #[test]
    fn treats_errors_unknown_and_contradictions_as_partial() {
        for result in [
            normalize_status(Some("clean"), true, true),
            normalize_status(Some("dart_error"), true, false),
            normalize_status(Some("unavailable"), true, true),
            normalize_status(Some("error"), true, false),
            normalize_status(Some("unknown"), true, false),
            normalize_status(None, true, false),
            normalize_status(Some("clean"), false, false),
        ] {
            assert_eq!(result.0, "partially_verified");
            assert!(result.1.is_some());
        }
    }
}
