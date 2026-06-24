use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const QUERY_TIMEOUT: Duration = Duration::from_millis(30000);

pub struct JavaDeepLayer {
    child: Child,
    stdin: ChildStdin,
    stdout: Arc<Mutex<BufReader<ChildStdout>>>,
    root: PathBuf,
}

pub struct JavaDeepLayerResult {
    pub issues: Vec<Value>,
    pub status: &'static str,
    pub reason: Option<String>,
    pub elapsed_ms: u128,
}

fn find_script(root: &Path) -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        let candidate = exe.parent()?.join("java-deep-layer.cjs");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    let candidates = [
        PathBuf::from("java-deep-layer.cjs"),
        root.join("java-deep-layer.cjs"),
    ];
    for c in &candidates {
        if c.exists() {
            return Some(c.clone());
        }
    }
    None
}

impl JavaDeepLayer {
    pub fn try_init(root: &Path) -> Result<Self, String> {
        let script = find_script(root).ok_or_else(|| "java-deep-layer.cjs not found".to_string())?;

        let mut child = Command::new("node")
            .arg(&script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("node spawn failed: {e}"))?;

        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout = Arc::new(Mutex::new(BufReader::new(child.stdout.take().ok_or("no stdout")?)));

        Ok(JavaDeepLayer { child, stdin, stdout, root: root.to_path_buf() })
    }

    pub fn query(&mut self, files: &[String]) -> Result<(Vec<Value>, u128), String> {
        let req = json!({
            "root": self.root.to_string_lossy().replace('\\', "/"),
            "files": files,
        });
        let line = serde_json::to_string(&req).unwrap() + "\n";
        self.stdin.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        self.stdin.flush().map_err(|e| e.to_string())?;

        let t0 = Instant::now();
        let stdout = Arc::clone(&self.stdout);
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut buf = String::new();
            let result = stdout.lock().unwrap().read_line(&mut buf).map(|_| buf);
            let _ = tx.send(result);
        });

        let resp_line = match rx.recv_timeout(QUERY_TIMEOUT) {
            Ok(Ok(line)) => line,
            Ok(Err(e)) => return Err(format!("read error: {e}")),
            Err(_) => {
                self.child.kill().ok();
                return Err("timeout: java helper did not respond within 30s".to_string());
            }
        };

        let elapsed = t0.elapsed().as_millis();
        if resp_line.is_empty() {
            return Err("java deep layer process closed".to_string());
        }
        let resp: Value = serde_json::from_str(resp_line.trim()).map_err(|e| e.to_string())?;
        if let Some(err) = resp.get("error").and_then(|e| e.as_str()) {
            return Err(err.to_string());
        }
        let issues = resp.get("issues")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        Ok((issues, elapsed))
    }
}

impl Drop for JavaDeepLayer {
    fn drop(&mut self) {
        self.child.kill().ok();
    }
}

pub fn run(deep: &mut Option<JavaDeepLayer>, root: &Path, files: &[String]) -> JavaDeepLayerResult {
    if deep.is_none() {
        match JavaDeepLayer::try_init(root) {
            Ok(d) => *deep = Some(d),
            Err(reason) => {
                return JavaDeepLayerResult {
                    issues: vec![],
                    status: "unavailable",
                    reason: Some(reason),
                    elapsed_ms: 0,
                };
            }
        }
    }

    let d = deep.as_mut().unwrap();
    match d.query(files) {
        Ok((issues, elapsed_ms)) => JavaDeepLayerResult {
            issues,
            status: "active",
            reason: None,
            elapsed_ms,
        },
        Err(reason) => {
            *deep = None;
            JavaDeepLayerResult {
                issues: vec![],
                status: "fallback",
                reason: Some(reason),
                elapsed_ms: 0,
            }
        }
    }
}
