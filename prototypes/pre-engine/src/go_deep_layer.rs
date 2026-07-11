use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::ts_deep_layer::StructureResult;

const QUERY_TIMEOUT: Duration = Duration::from_millis(120000);

pub struct GoDeepLayer {
    child: Child,
    stdin: ChildStdin,
    stdout: Arc<Mutex<BufReader<ChildStdout>>>,
    root: PathBuf,
}

pub struct GoDeepLayerResult {
    pub issues: Vec<Value>,
    pub status: &'static str,
    pub reason: Option<String>,
    pub verification: Value,
    pub program_build_count: u64,
    pub program_rebuilt: bool,
    pub snapshot_id: String,
    pub elapsed_ms: u128,
}

pub struct GoDiscoveryResult {
    pub candidates: Vec<Value>,
    pub status: &'static str,
    pub reason: Option<String>,
    pub program_build_count: u64,
    pub program_rebuilt: bool,
    pub snapshot_id: String,
    pub elapsed_ms: u128,
}

fn response_status(response: &Value) -> &'static str {
    match response.get("status").and_then(Value::as_str) {
        Some("verified") => "verified",
        Some("partially_verified") => "partially_verified",
        Some("tool_missing") => "tool_missing",
        _ => "partially_verified",
    }
}

fn find_script(root: &Path) -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        let candidate = exe.parent()?.join("go-deep-layer.cjs");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    [
        PathBuf::from("go-deep-layer.cjs"),
        root.join("go-deep-layer.cjs"),
    ]
    .into_iter()
    .find(|candidate| candidate.exists())
}

fn missing_verification(missing: &str) -> Value {
    json!({
        "coverage": [],
        "missing": [missing],
    })
}

impl GoDeepLayer {
    pub fn try_init(root: &Path) -> Result<Self, String> {
        let script = find_script(root).ok_or_else(|| "go-deep-layer.cjs not found".to_string())?;
        let mut child = Command::new("node")
            .arg(&script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("node spawn failed: {error}"))?;
        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout = Arc::new(Mutex::new(BufReader::new(
            child.stdout.take().ok_or("no stdout")?,
        )));
        Ok(Self {
            child,
            stdin,
            stdout,
            root: root.to_path_buf(),
        })
    }

    fn request(&mut self, request: Value) -> Result<(Value, u128), String> {
        let line = serde_json::to_string(&request).map_err(|error| error.to_string())? + "\n";
        self.stdin
            .write_all(line.as_bytes())
            .map_err(|error| error.to_string())?;
        self.stdin.flush().map_err(|error| error.to_string())?;

        let started = Instant::now();
        let stdout = Arc::clone(&self.stdout);
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut line = String::new();
            let result = stdout.lock().unwrap().read_line(&mut line).map(|_| line);
            let _ = tx.send(result);
        });
        let line = match rx.recv_timeout(QUERY_TIMEOUT) {
            Ok(Ok(line)) => line,
            Ok(Err(error)) => return Err(format!("read error: {error}")),
            Err(_) => {
                self.child.kill().ok();
                return Err(format!(
                    "timeout: gopls helper did not respond within {}ms",
                    QUERY_TIMEOUT.as_millis()
                ));
            }
        };
        if line.is_empty() {
            return Err("Go deep layer process closed".to_string());
        }
        let response = serde_json::from_str(line.trim()).map_err(|error| error.to_string())?;
        Ok((response, started.elapsed().as_millis()))
    }

    fn query_verify(&mut self, files: &[String]) -> Result<GoDeepLayerResult, String> {
        let root = self.root.to_string_lossy().replace('\\', "/");
        let (response, elapsed_ms) = self.request(json!({
            "op": "verify",
            "root": root,
            "files": files,
        }))?;
        Ok(GoDeepLayerResult {
            issues: response
                .get("issues")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
            status: response_status(&response),
            reason: response
                .get("reason")
                .and_then(Value::as_str)
                .map(str::to_string),
            verification: response
                .get("verification")
                .filter(|value| value.is_object())
                .cloned()
                .unwrap_or_else(|| missing_verification("gopls_metadata")),
            program_build_count: response
                .get("program_build_count")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            program_rebuilt: response
                .get("program_rebuilt")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            snapshot_id: response
                .get("snapshot_id")
                .and_then(Value::as_str)
                .unwrap_or("0")
                .to_string(),
            elapsed_ms,
        })
    }

    fn query_structure(
        &mut self,
        files: &[String],
        symbols: &[String],
        symbol_positions: &[Value],
        import_tokens: &[Value],
        allow_workspace_symbol: bool,
    ) -> Result<StructureResult, String> {
        let root = self.root.to_string_lossy().replace('\\', "/");
        let (response, elapsed_ms) = self.request(json!({
            "op": "analyze",
            "root": root,
            "files": files,
            "symbols": symbols,
            "symbol_positions": symbol_positions,
            "import_tokens": import_tokens,
            "allow_workspace_symbol": allow_workspace_symbol,
        }))?;
        Ok(StructureResult {
            relations: serde_json::from_value(
                response
                    .get("relations")
                    .cloned()
                    .unwrap_or_else(|| json!({})),
            )
            .map_err(|error| format!("invalid Go relations: {error}"))?,
            module_dependencies: serde_json::from_value(
                response
                    .get("module_dependencies")
                    .cloned()
                    .unwrap_or_else(|| json!({})),
            )
            .map_err(|error| format!("invalid Go module dependencies: {error}"))?,
            status: response_status(&response),
            reason: response
                .get("reason")
                .and_then(Value::as_str)
                .map(str::to_string),
            program_build_count: response
                .get("program_build_count")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            program_rebuilt: response
                .get("program_rebuilt")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            snapshot_id: response
                .get("snapshot_id")
                .and_then(Value::as_str)
                .unwrap_or("0")
                .to_string(),
            elapsed_ms,
        })
    }

    fn query_discovery(&mut self, terms: &[String]) -> Result<GoDiscoveryResult, String> {
        let root = self.root.to_string_lossy().replace('\\', "/");
        let (response, elapsed_ms) = self.request(json!({
            "op": "discover",
            "root": root,
            "terms": terms,
        }))?;
        Ok(GoDiscoveryResult {
            candidates: response
                .get("candidates")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
            status: response_status(&response),
            reason: response
                .get("reason")
                .and_then(Value::as_str)
                .map(str::to_string),
            program_build_count: response
                .get("program_build_count")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            program_rebuilt: response
                .get("program_rebuilt")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            snapshot_id: response
                .get("snapshot_id")
                .and_then(Value::as_str)
                .unwrap_or("0")
                .to_string(),
            elapsed_ms,
        })
    }
}

impl Drop for GoDeepLayer {
    fn drop(&mut self) {
        self.child.kill().ok();
    }
}

fn ensure_layer<'a>(
    deep: &'a mut Option<GoDeepLayer>,
    root: &Path,
) -> Result<&'a mut GoDeepLayer, String> {
    if deep.as_ref().is_some_and(|layer| layer.root != root) {
        *deep = None;
    }
    if deep.is_none() {
        *deep = Some(GoDeepLayer::try_init(root)?);
    }
    Ok(deep.as_mut().unwrap())
}

pub fn run(deep: &mut Option<GoDeepLayer>, root: &Path, files: &[String]) -> GoDeepLayerResult {
    let layer = match ensure_layer(deep, root) {
        Ok(layer) => layer,
        Err(reason) => return unavailable_result("partially_verified", reason),
    };
    match layer.query_verify(files) {
        Ok(result) => result,
        Err(reason) => {
            *deep = None;
            unavailable_result("partially_verified", reason)
        }
    }
}

pub fn run_structure(
    deep: &mut Option<GoDeepLayer>,
    root: &Path,
    files: &[String],
    symbols: &[String],
    symbol_positions: &[Value],
    import_tokens: &[Value],
    allow_workspace_symbol: bool,
) -> StructureResult {
    let layer = match ensure_layer(deep, root) {
        Ok(layer) => layer,
        Err(reason) => return unavailable_structure(symbols, "partially_verified", reason),
    };
    match layer.query_structure(
        files,
        symbols,
        symbol_positions,
        import_tokens,
        allow_workspace_symbol,
    ) {
        Ok(result) => result,
        Err(reason) => {
            *deep = None;
            unavailable_structure(symbols, "partially_verified", reason)
        }
    }
}

pub fn run_discovery(
    deep: &mut Option<GoDeepLayer>,
    root: &Path,
    terms: &[String],
) -> GoDiscoveryResult {
    let layer = match ensure_layer(deep, root) {
        Ok(layer) => layer,
        Err(reason) => {
            return GoDiscoveryResult {
                candidates: vec![],
                status: "partially_verified",
                reason: Some(reason),
                program_build_count: 0,
                program_rebuilt: false,
                snapshot_id: "0".to_string(),
                elapsed_ms: 0,
            }
        }
    };
    match layer.query_discovery(terms) {
        Ok(result) => result,
        Err(reason) => {
            *deep = None;
            GoDiscoveryResult {
                candidates: vec![],
                status: "partially_verified",
                reason: Some(reason),
                program_build_count: 0,
                program_rebuilt: false,
                snapshot_id: "0".to_string(),
                elapsed_ms: 0,
            }
        }
    }
}

pub fn disabled_structure(symbols: &[String]) -> StructureResult {
    unavailable_structure(symbols, "disabled", "no Go files selected".to_string())
}

fn unavailable_result(status: &'static str, reason: String) -> GoDeepLayerResult {
    GoDeepLayerResult {
        issues: vec![],
        status,
        reason: Some(reason),
        verification: missing_verification("gopls"),
        program_build_count: 0,
        program_rebuilt: false,
        snapshot_id: "0".to_string(),
        elapsed_ms: 0,
    }
}

fn unavailable_structure(
    symbols: &[String],
    status: &'static str,
    reason: String,
) -> StructureResult {
    StructureResult {
        relations: symbols
            .iter()
            .map(|symbol| (symbol.clone(), Default::default()))
            .collect(),
        module_dependencies: Default::default(),
        status,
        reason: Some(reason),
        program_build_count: 0,
        program_rebuilt: false,
        snapshot_id: "0".to_string(),
        elapsed_ms: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocol_failures_never_map_to_fallback_or_tool_missing() {
        for status in ["error", "protocol_error", "fallback_used", "unknown"] {
            assert_eq!(
                response_status(&json!({ "status": status })),
                "partially_verified"
            );
        }
        assert_eq!(
            response_status(&json!({ "status": "tool_missing" })),
            "tool_missing"
        );
    }
}
