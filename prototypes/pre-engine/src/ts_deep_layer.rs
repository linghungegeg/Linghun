use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const QUERY_TIMEOUT: Duration = Duration::from_millis(15000);
const STRUCTURE_QUERY_TIMEOUT: Duration = Duration::from_millis(120000);

pub struct DeepLayer {
    child: Child,
    stdin: ChildStdin,
    stdout: Arc<Mutex<BufReader<ChildStdout>>>,
    root: PathBuf,
}

pub struct DeepLayerResult {
    pub issues: Vec<Value>,
    pub status: &'static str,
    pub reason: Option<String>,
    pub verification: Value,
    pub language_results: Value,
    pub program_build_count: u64,
    pub program_rebuilt: bool,
    pub snapshot_id: String,
    pub elapsed_ms: u128,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SymbolTarget {
    pub file: String,
    pub name: String,
    #[serde(default)]
    pub line: usize,
    #[serde(default)]
    pub character: usize,
    #[serde(default)]
    pub end_line: usize,
    #[serde(default)]
    pub end_character: usize,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SemanticLocation {
    pub file: String,
    pub name: String,
    pub line: usize,
    pub character: usize,
    pub end_line: usize,
    pub end_character: usize,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SymbolRelations {
    pub targets: Vec<SymbolTarget>,
    pub names_by_file: HashMap<String, Vec<String>>,
    pub related_files: Vec<String>,
    #[serde(default)]
    pub references: Vec<SemanticLocation>,
    #[serde(default)]
    pub callers: Vec<SemanticLocation>,
    #[serde(default)]
    pub callees: Vec<SemanticLocation>,
    pub unresolved_module_specifiers: Vec<String>,
    pub unresolved_relative_specifiers: Vec<String>,
    pub external_module_specifiers: Vec<String>,
    pub blocked_module_specifiers: Vec<String>,
    pub dynamic_import_files: Vec<String>,
    pub graph_cycle: bool,
    pub graph_truncated: bool,
}

impl SymbolRelations {
    pub fn has_evidence(&self) -> bool {
        !self.targets.is_empty()
            || !self.unresolved_module_specifiers.is_empty()
            || !self.unresolved_relative_specifiers.is_empty()
            || !self.external_module_specifiers.is_empty()
            || !self.blocked_module_specifiers.is_empty()
            || !self.dynamic_import_files.is_empty()
            || self.graph_cycle
            || self.graph_truncated
    }
}

pub struct StructureResult {
    pub relations: HashMap<String, SymbolRelations>,
    pub module_dependencies: HashMap<String, Vec<String>>,
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
        Some("fallback_used") => "fallback_used",
        Some("tool_missing") => "tool_missing",
        _ => "fallback_used",
    }
}

fn find_script(root: &Path) -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        let candidate = exe.parent()?.join("ts-deep-layer.cjs");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    let candidates = [
        PathBuf::from("ts-deep-layer.cjs"),
        root.join("ts-deep-layer.cjs"),
    ];
    for c in &candidates {
        if c.exists() {
            return Some(c.clone());
        }
    }
    None
}

fn find_tsconfig(root: &Path) -> Option<PathBuf> {
    let p = root.join("tsconfig.json");
    if p.exists() { Some(p) } else { None }
}

fn fallback_verification(root: &Path, missing: &str) -> Value {
    let tsconfig = find_tsconfig(root)
        .and_then(|path| path.strip_prefix(root).ok().map(Path::to_path_buf))
        .map(|path| path.to_string_lossy().replace('\\', "/"));
    json!({
        "tsconfig": tsconfig,
        "jsx_mode": "not_checked",
        "typescript_version": null,
        "coverage": [],
        "missing": [missing],
    })
}

fn response_verification(response: &Value, root: &Path) -> (Value, bool) {
    match response.get("verification").filter(|value| value.is_object()) {
        Some(verification) => (verification.clone(), false),
        None => (
            fallback_verification(root, "typescript_deep_layer_metadata"),
            true,
        ),
    }
}

fn unavailable_result(
    root: &Path,
    status: &'static str,
    reason: String,
    missing: &str,
) -> DeepLayerResult {
    let verification = fallback_verification(root, missing);
    let language_result = json!({
        "status": status,
        "reason": reason.clone(),
        "verification": verification.clone(),
    });
    DeepLayerResult {
        issues: vec![],
        status,
        reason: Some(reason.clone()),
        verification: verification.clone(),
        language_results: json!({
            "TypeScript": language_result,
            "TSX": {
                "status": status,
                "reason": reason,
                "verification": verification,
            },
        }),
        program_build_count: 0,
        program_rebuilt: false,
        snapshot_id: "0".to_string(),
        elapsed_ms: 0,
    }
}

pub fn result_for_language(
    result: &DeepLayerResult,
    language: &str,
) -> (&'static str, Option<String>, Value) {
    let language_result = result.language_results.get(language);
    let status = language_result.map(response_status).unwrap_or(result.status);
    let reason = language_result
        .and_then(|value| value.get("reason"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| result.reason.clone());
    let verification = language_result
        .and_then(|value| value.get("verification"))
        .filter(|value| value.is_object())
        .cloned()
        .unwrap_or_else(|| result.verification.clone());
    (status, reason, verification)
}

impl DeepLayer {
    pub fn try_init(root: &Path) -> Result<Self, String> {
        let script = find_script(root).ok_or_else(|| "ts-deep-layer.cjs not found".to_string())?;

        let mut child = Command::new("node")
            .arg(&script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("node spawn failed: {e}"))?;

        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout = Arc::new(Mutex::new(BufReader::new(child.stdout.take().ok_or("no stdout")?)));

        Ok(DeepLayer { child, stdin, stdout, root: root.to_path_buf() })
    }

    fn request(&mut self, req: Value, timeout: Duration) -> Result<(Value, u128), String> {
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

        let resp_line = match rx.recv_timeout(timeout) {
            Ok(Ok(line)) => line,
            Ok(Err(e)) => return Err(format!("read error: {e}")),
            Err(_) => {
                self.child.kill().ok();
                return Err(format!(
                    "timeout: node helper did not respond within {}ms",
                    timeout.as_millis()
                ));
            }
        };

        let elapsed = t0.elapsed().as_millis();
        if resp_line.is_empty() {
            return Err("deep layer process closed".to_string());
        }
        let resp: Value = serde_json::from_str(resp_line.trim()).map_err(|e| e.to_string())?;
        if let Some(err) = resp.get("error").and_then(|e| e.as_str()) {
            return Err(err.to_string());
        }
        Ok((resp, elapsed))
    }

    pub fn query(&mut self, files: &[String]) -> Result<DeepLayerResult, String> {
        let tsconfig = find_tsconfig(&self.root)
            .map(|p| p.to_string_lossy().replace('\\', "/"));
        let req = json!({
            "root": self.root.to_string_lossy().replace('\\', "/"),
            "files": files,
            "tsconfig": tsconfig,
        });
        let (resp, elapsed) = self.request(req, QUERY_TIMEOUT)?;
        let issues = resp.get("issues")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let status = response_status(&resp);
        let reason = resp.get("reason")
            .and_then(Value::as_str)
            .map(str::to_string);
        let (verification, metadata_missing) = response_verification(&resp, &self.root);
        let status = if metadata_missing && status != "tool_missing" {
            "fallback_used"
        } else {
            status
        };
        let reason = reason.or_else(|| metadata_missing.then(|| {
            "TypeScript helper response did not include verification metadata".to_string()
        }));
        let language_results = resp
            .get("language_results")
            .filter(|value| value.is_object())
            .cloned()
            .unwrap_or_else(|| json!({
                "TypeScript": {
                    "status": status,
                    "reason": reason,
                    "verification": verification,
                },
                "TSX": {
                    "status": status,
                    "reason": reason,
                    "verification": verification,
                },
            }));
        let program_build_count = resp
            .get("program_build_count")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let program_rebuilt = resp
            .get("program_rebuilt")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let snapshot_id = resp
            .get("snapshot_id")
            .and_then(Value::as_str)
            .unwrap_or("0")
            .to_string();
        Ok(DeepLayerResult {
            issues,
            status,
            reason,
            verification,
            language_results,
            program_build_count,
            program_rebuilt,
            snapshot_id,
            elapsed_ms: elapsed,
        })
    }

    pub fn query_prepare(&mut self, files: &[String]) -> Result<(), String> {
        let tsconfig = find_tsconfig(&self.root)
            .map(|path| path.to_string_lossy().replace('\\', "/"));
        let req = json!({
            "op": "prepare",
            "root": self.root.to_string_lossy().replace('\\', "/"),
            "files": files,
            "tsconfig": tsconfig,
        });
        self.request(req, STRUCTURE_QUERY_TIMEOUT).map(|_| ())
    }

    pub fn query_structure(
        &mut self,
        files: &[String],
        symbols: &[String],
        preferred_files: &[String],
    ) -> Result<StructureResult, String> {
        let tsconfig = find_tsconfig(&self.root)
            .map(|path| path.to_string_lossy().replace('\\', "/"));
        let req = json!({
            "op": "analyze",
            "root": self.root.to_string_lossy().replace('\\', "/"),
            "files": files,
            "symbols": symbols,
            "preferred_files": preferred_files,
            "tsconfig": tsconfig,
        });
        let (resp, elapsed_ms) = self.request(req, STRUCTURE_QUERY_TIMEOUT)?;
        let status = response_status(&resp);
        let reason = resp.get("reason")
            .and_then(Value::as_str)
            .map(str::to_string);
        let (_, metadata_missing) = response_verification(&resp, &self.root);
        let status = if metadata_missing && status != "tool_missing" {
            "fallback_used"
        } else {
            status
        };
        let reason = reason.or_else(|| metadata_missing.then(|| {
            "TypeScript helper response did not include verification metadata".to_string()
        }));
        let relations = serde_json::from_value(
            resp.get("relations")
                .cloned()
                .ok_or("TypeScript helper response did not include relations")?,
        ).map_err(|error| format!("invalid TypeScript relations: {error}"))?;
        let module_dependencies = serde_json::from_value(
            resp.get("module_dependencies")
                .cloned()
                .ok_or("TypeScript helper response did not include module_dependencies")?,
        ).map_err(|error| format!("invalid TypeScript module dependencies: {error}"))?;
        let program_build_count = resp.get("program_build_count")
            .and_then(Value::as_u64)
            .ok_or("TypeScript helper response did not include program_build_count")?;
        let program_rebuilt = resp.get("program_rebuilt")
            .and_then(Value::as_bool)
            .ok_or("TypeScript helper response did not include program_rebuilt")?;
        let snapshot_id = resp.get("snapshot_id")
            .and_then(Value::as_str)
            .ok_or("TypeScript helper response did not include snapshot_id")?
            .to_string();
        Ok(StructureResult {
            relations,
            module_dependencies,
            status,
            reason,
            program_build_count,
            program_rebuilt,
            snapshot_id,
            elapsed_ms,
        })
    }
}

impl Drop for DeepLayer {
    fn drop(&mut self) {
        self.child.kill().ok();
    }
}

fn ensure_layer<'a>(deep: &'a mut Option<DeepLayer>, root: &Path) -> Result<&'a mut DeepLayer, String> {
    if deep.as_ref().is_some_and(|layer| layer.root != root) {
        *deep = None;
    }
    if deep.is_none() {
        *deep = Some(DeepLayer::try_init(root)?);
    }
    Ok(deep.as_mut().unwrap())
}

pub fn run(deep: &mut Option<DeepLayer>, root: &Path, files: &[String]) -> DeepLayerResult {
    let layer = match ensure_layer(deep, root) {
        Ok(layer) => layer,
        Err(reason) => {
            return unavailable_result(
                root,
                "tool_missing",
                format!("TypeScript tool_missing: {reason}"),
                "typescript_deep_layer",
            );
        }
    };
    match layer.query(files) {
        Ok(result) => result,
        Err(reason) => {
            // process died; clear so next call can re-init
            *deep = None;
            unavailable_result(
                root,
                "fallback_used",
                reason,
                "typescript_deep_layer_response",
            )
        }
    }
}

pub fn prepare(deep: &mut Option<DeepLayer>, root: &Path, files: &[String]) {
    let Ok(layer) = ensure_layer(deep, root) else {
        return;
    };
    if layer.query_prepare(files).is_err() {
        *deep = None;
    }
}

pub fn run_structure(
    deep: &mut Option<DeepLayer>,
    root: &Path,
    files: &[String],
    symbols: &[String],
    preferred_files: &[String],
) -> StructureResult {
    let layer = match ensure_layer(deep, root) {
        Ok(layer) => layer,
        Err(reason) => {
            return unavailable_structure_result(
                symbols,
                "tool_missing",
                format!("TypeScript tool_missing: {reason}; missing=typescript_deep_layer"),
            );
        }
    };
    match layer.query_structure(files, symbols, preferred_files) {
        Ok(result) => result,
        Err(reason) => {
            *deep = None;
            unavailable_structure_result(
                symbols,
                "fallback_used",
                format!("{reason}; missing=typescript_deep_layer_response"),
            )
        }
    }
}

pub fn disabled_structure(symbols: &[String]) -> StructureResult {
    unavailable_structure_result(
        symbols,
        "disabled",
        "no TypeScript files selected".to_string(),
    )
}

fn unavailable_structure_result(
    symbols: &[String],
    status: &'static str,
    reason: String,
) -> StructureResult {
    StructureResult {
        relations: symbols.iter()
            .map(|symbol| (symbol.clone(), SymbolRelations::default()))
            .collect(),
        module_dependencies: HashMap::new(),
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
    fn preserves_helper_verification_metadata() {
        let verification = json!({
            "tsconfig": "tsconfig.json",
            "jsx_mode": "react-jsx",
            "typescript_version": "5.9.3",
            "coverage": ["syntax", "types", "module_resolution"],
            "missing": ["jsx_runtime_types"],
        });
        let response = json!({
            "status": "partially_verified",
            "issues": [],
            "verification": verification,
        });

        let (actual, metadata_missing) =
            response_verification(&response, Path::new("Z:/synthetic/project"));
        assert!(!metadata_missing);
        assert_eq!(actual, verification);
    }

    #[test]
    fn selects_independent_language_results() {
        let result = DeepLayerResult {
            issues: vec![],
            status: "partially_verified",
            reason: Some("mixed result".to_string()),
            verification: json!({ "missing": ["jsx_compiler_option"] }),
            language_results: json!({
                "TypeScript": {
                    "status": "verified",
                    "reason": "typescript verified",
                    "verification": { "missing": [] },
                },
                "TSX": {
                    "status": "fallback_used",
                    "reason": "tsx fallback",
                    "verification": { "missing": ["jsx_compiler_option"] },
                },
            }),
            program_build_count: 1,
            program_rebuilt: false,
            snapshot_id: "1".to_string(),
            elapsed_ms: 1,
        };

        let (typescript_status, _, typescript_verification) =
            result_for_language(&result, "TypeScript");
        let (tsx_status, _, tsx_verification) = result_for_language(&result, "TSX");

        assert_eq!(typescript_status, "verified");
        assert_eq!(typescript_verification.get("missing"), Some(&json!([])));
        assert_eq!(tsx_status, "fallback_used");
        assert_eq!(
            tsx_verification.get("missing"),
            Some(&json!(["jsx_compiler_option"]))
        );
    }

    #[test]
    fn fallback_metadata_has_the_serializable_verification_shape() {
        let result = unavailable_result(
            Path::new("Z:/synthetic/project"),
            "tool_missing",
            "node unavailable".to_string(),
            "typescript_deep_layer",
        );

        assert_eq!(result.status, "tool_missing");
        assert_eq!(result.verification.get("tsconfig"), Some(&Value::Null));
        assert_eq!(result.verification.get("jsx_mode"), Some(&json!("not_checked")));
        assert_eq!(result.verification.get("typescript_version"), Some(&Value::Null));
        assert_eq!(result.verification.get("coverage"), Some(&json!([])));
        assert_eq!(result.verification.get("missing"), Some(&json!(["typescript_deep_layer"])));
        assert_eq!(
            result.language_results.pointer("/TypeScript/status"),
            Some(&json!("tool_missing"))
        );

        let (verification, metadata_missing) = response_verification(
            &json!({ "status": "verified", "issues": [] }),
            Path::new("Z:/synthetic/project"),
        );
        assert!(metadata_missing);
        assert_eq!(
            verification.get("missing"),
            Some(&json!(["typescript_deep_layer_metadata"]))
        );
    }
}
