use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const QUERY_TIMEOUT: Duration = Duration::from_millis(30000);

pub struct PyDeepLayer {
    child: Child,
    stdin: ChildStdin,
    stdout: Arc<Mutex<BufReader<ChildStdout>>>,
    root: PathBuf,
}

pub struct PyDeepLayerResult {
    pub issues: Vec<Value>,
    pub status: &'static str,
    pub reason: Option<String>,
    pub elapsed_ms: u128,
}

fn find_script(root: &Path) -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        let candidate = exe.parent()?.join("py-deep-layer.cjs");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    let candidates = [
        PathBuf::from("py-deep-layer.cjs"),
        root.join("py-deep-layer.cjs"),
    ];
    for c in &candidates {
        if c.exists() {
            return Some(c.clone());
        }
    }
    None
}

fn find_pyrightconfig(root: &Path) -> Option<PathBuf> {
    let p = root.join("pyrightconfig.json");
    if p.exists() { Some(p) } else { None }
}

impl PyDeepLayer {
    pub fn try_init(root: &Path) -> Result<Self, String> {
        let script = find_script(root).ok_or_else(|| "py-deep-layer.cjs not found".to_string())?;

        let mut child = Command::new("node")
            .arg(&script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("node spawn failed: {e}"))?;

        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout = Arc::new(Mutex::new(BufReader::new(child.stdout.take().ok_or("no stdout")?)));

        Ok(PyDeepLayer { child, stdin, stdout, root: root.to_path_buf() })
    }

    pub fn query(&mut self, files: &[String]) -> Result<(Vec<Value>, u128), String> {
        let pyrightconfig = find_pyrightconfig(&self.root)
            .map(|p| p.to_string_lossy().replace('\\', "/"));

        let req = json!({
            "root": self.root.to_string_lossy().replace('\\', "/"),
            "files": files,
            "pyrightconfig": pyrightconfig,
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
                return Err("timeout: pyright helper did not respond within 30s".to_string());
            }
        };

        let elapsed = t0.elapsed().as_millis();
        if resp_line.is_empty() {
            return Err("python deep layer process closed".to_string());
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

impl Drop for PyDeepLayer {
    fn drop(&mut self) {
        self.child.kill().ok();
    }
}

pub fn run(deep: &mut Option<PyDeepLayer>, root: &Path, files: &[String]) -> PyDeepLayerResult {
    if deep.is_none() {
        match PyDeepLayer::try_init(root) {
            Ok(d) => *deep = Some(d),
            Err(reason) => {
                return PyDeepLayerResult {
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
        Ok((issues, elapsed_ms)) => PyDeepLayerResult {
            issues,
            status: "active",
            reason: None,
            elapsed_ms,
        },
        Err(reason) => {
            *deep = None;
            PyDeepLayerResult {
                issues: vec![],
                status: "fallback",
                reason: Some(reason),
                elapsed_ms: 0,
            }
        }
    }
}