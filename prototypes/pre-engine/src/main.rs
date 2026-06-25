mod csharp_deep_layer;
mod go_deep_layer;
mod index;
mod java_deep_layer;
mod kotlin_deep_layer;
mod language;
mod php_deep_layer;
mod py_deep_layer;
mod ruby_deep_layer;
mod rust_deep_layer;
mod shell_deep_layer;
mod sql_deep_layer;
mod symbols;
mod ts_deep_layer;

use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{self, BufRead, Write};
use std::path::PathBuf;

use crate::index::Index;

fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut stdout_lock = stdout.lock();
    let mut index: Option<Index> = None;
    let mut deep_layer: Option<ts_deep_layer::DeepLayer> = None;
    let mut py_layer: Option<py_deep_layer::PyDeepLayer> = None;
    let mut rust_layer: Option<rust_deep_layer::RustDeepLayer> = None;
    let mut go_layer: Option<go_deep_layer::GoDeepLayer> = None;
    let mut java_layer: Option<java_deep_layer::JavaDeepLayer> = None;
    let mut sql_layer: Option<sql_deep_layer::SqlDeepLayer> = None;
    let mut shell_layer: Option<shell_deep_layer::ShellDeepLayer> = None;
    let mut csharp_layer: Option<csharp_deep_layer::CsharpDeepLayer> = None;
    let mut php_layer: Option<php_deep_layer::PhpDeepLayer> = None;
    let mut ruby_layer: Option<ruby_deep_layer::RubyDeepLayer> = None;
    let mut kotlin_layer: Option<kotlin_deep_layer::KotlinDeepLayer> = None;

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }
        let request: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(response) = handle_request(&request, &mut index, &mut deep_layer, &mut py_layer, &mut rust_layer, &mut go_layer, &mut java_layer, &mut sql_layer, &mut shell_layer, &mut csharp_layer, &mut php_layer, &mut ruby_layer, &mut kotlin_layer) {
            let out = serde_json::to_string(&response).unwrap();
            writeln!(stdout_lock, "{}", out).ok();
            stdout_lock.flush().ok();
        }
    }
}

fn handle_request(request: &Value, index: &mut Option<Index>, deep_layer: &mut Option<ts_deep_layer::DeepLayer>, py_layer: &mut Option<py_deep_layer::PyDeepLayer>, rust_layer: &mut Option<rust_deep_layer::RustDeepLayer>, go_layer: &mut Option<go_deep_layer::GoDeepLayer>, java_layer: &mut Option<java_deep_layer::JavaDeepLayer>, sql_layer: &mut Option<sql_deep_layer::SqlDeepLayer>, shell_layer: &mut Option<shell_deep_layer::ShellDeepLayer>, csharp_layer: &mut Option<csharp_deep_layer::CsharpDeepLayer>, php_layer: &mut Option<php_deep_layer::PhpDeepLayer>, ruby_layer: &mut Option<ruby_deep_layer::RubyDeepLayer>, kotlin_layer: &mut Option<kotlin_deep_layer::KotlinDeepLayer>) -> Option<Value> {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let method = request.get("method").and_then(|m| m.as_str()).unwrap_or("");

    match method {
        "initialize" => {
            let root = request
                .pointer("/params/rootUri")
                .and_then(|v| v.as_str())
                .or_else(|| request.pointer("/params/rootPath").and_then(|v| v.as_str()))
                .unwrap_or(".");
            let root_path = PathBuf::from(root);
            let mut idx = Index::new(root_path);
            idx.build();
            *index = Some(idx);
            Some(json_rpc_result(id, json!({
                "protocolVersion": "2025-06-18",
                "capabilities": {
                    "tools": {}
                },
                "serverInfo": {
                    "name": "linghun-pre-engine",
                    "version": "0.1.0"
                }
            })))
        }
        "notifications/initialized" => None,
        "tools/list" => Some(json_rpc_result(id, json!({
            "tools": tool_definitions()
        }))),
        "tools/call" => {
            let tool_name = request
                .pointer("/params/name")
                .and_then(|n| n.as_str())
                .unwrap_or("");
            let arguments = request
                .pointer("/params/arguments")
                .cloned()
                .unwrap_or(json!({}));
            let result = handle_tool_call(tool_name, &arguments, index, deep_layer, py_layer, rust_layer, go_layer, java_layer, sql_layer, shell_layer, csharp_layer, php_layer, ruby_layer, kotlin_layer);
            Some(json_rpc_result(id, result))
        }
        _ => Some(json_rpc_error(id, -32601, "Method not found")),
    }
}

fn json_rpc_result(id: Value, result: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result
    })
}

fn json_rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message
        }
    })
}

fn tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "pre_context",
            "description": "查询符号的定义、引用、调用关系等结构化上下文事实。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "symbol": { "type": "string", "description": "目标符号名" },
                    "path": { "type": "string", "description": "限定搜索范围的文件路径（可选）" },
                    "depth": { "type": "number", "description": "调用链展开深度（默认 1）" }
                },
                "required": ["symbol"]
            }
        }),
        json!({
            "name": "pre_impact",
            "description": "给定变更的文件/符号，返回受影响的文件、函数和测试。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "changes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "path": { "type": "string" },
                                "symbols": { "type": "array", "items": { "type": "string" } }
                            },
                            "required": ["path"]
                        }
                    }
                },
                "required": ["changes"]
            }
        }),
        json!({
            "name": "pre_plan",
            "description": "给定变更目标，返回确定性的文件编辑顺序和依赖约束。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "task": { "type": "string", "description": "任务描述" },
                    "target_symbols": { "type": "array", "items": { "type": "string" } },
                    "target_files": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["task"]
            }
        }),
        json!({
            "name": "pre_verify",
            "description": "变更后快速预检签名/import/导出一致性。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "changed_files": {
                        "type": "array",
                        "items": { "type": "string" }
                    }
                },
                "required": ["changed_files"]
            }
        }),
    ]
}

fn handle_tool_call(tool_name: &str, arguments: &Value, index: &mut Option<Index>, deep_layer: &mut Option<ts_deep_layer::DeepLayer>, py_layer: &mut Option<py_deep_layer::PyDeepLayer>, rust_layer: &mut Option<rust_deep_layer::RustDeepLayer>, go_layer: &mut Option<go_deep_layer::GoDeepLayer>, java_layer: &mut Option<java_deep_layer::JavaDeepLayer>, sql_layer: &mut Option<sql_deep_layer::SqlDeepLayer>, shell_layer: &mut Option<shell_deep_layer::ShellDeepLayer>, csharp_layer: &mut Option<csharp_deep_layer::CsharpDeepLayer>, php_layer: &mut Option<php_deep_layer::PhpDeepLayer>, ruby_layer: &mut Option<ruby_deep_layer::RubyDeepLayer>, kotlin_layer: &mut Option<kotlin_deep_layer::KotlinDeepLayer>) -> Value {
    match tool_name {
        "pre_context" => {
            let symbol = arguments.get("symbol").and_then(|s| s.as_str()).unwrap_or("");
            if symbol.is_empty() {
                return tool_error("symbol is required");
            }
            if let Some(idx) = index.as_mut() {
                idx.refresh();
                let root_str = idx.root.to_string_lossy().to_string();
                let mut definitions = Vec::new();
                let mut references = Vec::new();
                let mut callees = Vec::new();
                let mut callers = Vec::new();
                for entry in idx.files() {
                    let defs = symbols::extract_definitions(&entry.tree, &entry.source, &entry.path, entry.lang);
                    for d in &defs {
                        if d.name == symbol {
                            definitions.push(d.clone());
                        }
                    }
                    let refs = symbols::extract_references(&entry.tree, &entry.source, &entry.path, symbol);
                    references.extend(refs);
                    let ces = symbols::extract_callees(&entry.tree, &entry.source, &entry.path, symbol, entry.lang);
                    callees.extend(ces);
                    let crs = symbols::extract_callers(&entry.tree, &entry.source, &entry.path, symbol, entry.lang);
                    callers.extend(crs);
                }
                let definition = definitions.first().map(|d| json!({
                    "name": d.name,
                    "file": d.file,
                    "line": d.line,
                    "kind": format!("{:?}", d.kind),
                    "signature": d.signature,
                }));
                let refs_json: Vec<Value> = references.iter().map(|r| json!({
                    "file": r.file,
                    "line": r.line,
                })).collect();
                let callees_json: Vec<Value> = callees.iter().map(|c| json!({
                    "name": c.name,
                    "file": c.file,
                    "line": c.line,
                })).collect();
                let callers_json: Vec<Value> = callers.iter().map(|c| json!({
                    "name": c.name,
                    "file": c.file,
                    "line": c.line,
                })).collect();
                let mut affected_files: HashSet<String> = HashSet::new();
                let mut suggested_minimal_reads: Vec<Value> = Vec::new();
                for d in &definitions {
                    let rel = make_relative(&d.file, &root_str);
                    affected_files.insert(rel.clone());
                    push_read_hint_unique(&mut suggested_minimal_reads, rel, d.line, "definition");
                }
                for r in &references {
                    affected_files.insert(make_relative(&r.file, &root_str));
                }
                for c in callers.iter().chain(callees.iter()) {
                    affected_files.insert(make_relative(&c.file, &root_str));
                }
                for c in callers.iter().take(4) {
                    push_read_hint_unique(
                        &mut suggested_minimal_reads,
                        make_relative(&c.file, &root_str),
                        c.line,
                        "caller",
                    );
                }
                let related_tests = find_related_tests(&affected_files, &HashSet::new(), idx);
                for test in related_tests.iter().take(4) {
                    push_read_hint_unique(&mut suggested_minimal_reads, test.clone(), 1, "related test");
                }
                let mut missing_evidence = Vec::new();
                if definitions.is_empty() {
                    missing_evidence.push("definition");
                }
                let confidence = if definitions.is_empty() {
                    "low"
                } else if callers.is_empty() && references.is_empty() {
                    "medium"
                } else {
                    "high"
                };
                let entry_points: Vec<Value> = definitions
                    .iter()
                    .take(3)
                    .map(|d| json!({
                        "name": d.name,
                        "file": make_relative(&d.file, &root_str),
                        "line": d.line,
                        "kind": format!("{:?}", d.kind),
                    }))
                    .collect();
                let caller_chain: Vec<Value> = callers
                    .iter()
                    .take(8)
                    .map(|c| json!({
                        "name": c.name,
                        "file": make_relative(&c.file, &root_str),
                        "line": c.line,
                    }))
                    .collect();
                let result = json!({
                    "definition": definition,
                    "references": refs_json,
                    "callees": callees_json,
                    "callers": callers_json,
                    "signature": definitions.first().map(|d| d.signature.as_str()).unwrap_or(""),
                    "answer_pack": build_answer_pack(
                        "context",
                        confidence,
                        entry_points,
                        caller_chain,
                        sorted_hash_set_strings(&affected_files),
                        related_tests,
                        vec![
                            "tool dispatch order",
                            "permission and approval boundary",
                            "tool result and evidence recording",
                            "related tests and prompt/tool schema drift",
                        ],
                        suggested_minimal_reads,
                        missing_evidence,
                    ),
                });
                json!({
                    "content": [{
                        "type": "text",
                        "text": serde_json::to_string_pretty(&result).unwrap_or_default()
                    }]
                })
            } else {
                tool_error("index not initialized — send initialize with rootUri first")
            }
        }
        "pre_impact" => {
            handle_pre_impact(arguments, index)
        }
        "pre_plan" => {
            handle_pre_plan(arguments, index)
        }
        "pre_verify" => {
            handle_pre_verify(arguments, index, deep_layer, py_layer, rust_layer, go_layer, java_layer, sql_layer, shell_layer, csharp_layer, php_layer, ruby_layer, kotlin_layer)
        }
        _ => {
            json!({
                "content": [{
                    "type": "text",
                    "text": format!("unknown tool: {}", tool_name)
                }],
                "isError": true
            })
        }
    }
}

fn handle_pre_impact(arguments: &Value, index: &mut Option<Index>) -> Value {
    let changes = match arguments.get("changes").and_then(|c| c.as_array()) {
        Some(arr) => arr,
        None => return tool_error("changes array is required"),
    };
    let idx = match index.as_mut() {
        Some(i) => i,
        None => return tool_error("index not initialized — send initialize with rootUri first"),
    };
    idx.refresh();

    let root_str = idx.root.to_string_lossy().to_string();
    let mut seed_symbols: Vec<String> = Vec::new();
    let mut changed_files: HashSet<String> = HashSet::new();

    for change in changes {
        if let Some(path) = change.get("path").and_then(|p| p.as_str()) {
            changed_files.insert(make_relative(path, &root_str));
        }
        if let Some(syms) = change.get("symbols").and_then(|s| s.as_array()) {
            for s in syms {
                if let Some(name) = s.as_str() {
                    seed_symbols.push(name.to_string());
                }
            }
        }
    }

    if seed_symbols.is_empty() {
        for entry in idx.files() {
            let entry_rel = make_relative(&entry.path.to_string_lossy(), &root_str);
            if changed_files.contains(&entry_rel) {
                let defs = symbols::extract_definitions(&entry.tree, &entry.source, &entry.path, entry.lang);
                for d in defs {
                    seed_symbols.push(d.name);
                }
            }
        }
    }

    let max_depth: usize = 2;
    let mut visited: HashSet<String> = HashSet::new();
    let mut queue: VecDeque<(String, usize)> = VecDeque::new();
    let mut affected_functions: Vec<Value> = Vec::new();
    let mut affected_files: HashSet<String> = HashSet::new();

    for sym in &seed_symbols {
        visited.insert(sym.clone());
        queue.push_back((sym.clone(), 0));
    }

    let file_entries: Vec<(&PathBuf, &tree_sitter::Tree, &str, crate::language::Lang)> = idx
        .files()
        .map(|e| (&e.path, &e.tree, e.source.as_str(), e.lang))
        .collect();

    while let Some((sym, depth)) = queue.pop_front() {
        for (path, tree, source, lang) in &file_entries {
            let callers = symbols::extract_callers(tree, source, path, &sym, *lang);
            for caller in callers {
                let rel_file = make_relative(&caller.file, &root_str);
                affected_files.insert(rel_file.clone());
                if !visited.contains(&caller.name) {
                    visited.insert(caller.name.clone());
                    affected_functions.push(json!({
                        "name": caller.name,
                        "file": rel_file,
                        "line": caller.line,
                        "depth": depth + 1,
                    }));
                    if depth + 1 < max_depth {
                        queue.push_back((caller.name.clone(), depth + 1));
                    }
                }
            }
        }
    }

    for f in &changed_files {
        affected_files.insert(f.clone());
    }

    let related_tests = find_related_tests(&changed_files, &affected_files, idx);
    let affected_files_sorted = sorted_hash_set_strings(&affected_files);
    let mut suggested_minimal_reads: Vec<Value> = affected_files_sorted
        .iter()
        .map(|file| read_hint(file.clone(), 1, "affected file"))
        .collect();
    for test in related_tests.iter().take(6) {
        push_read_hint_unique(&mut suggested_minimal_reads, test.clone(), 1, "related test");
    }

    let result = json!({
        "affected_files": affected_files_sorted,
        "affected_functions": affected_functions,
        "related_tests": related_tests,
        "seed_symbols": seed_symbols,
        "answer_pack": build_answer_pack(
            "impact",
            "high",
            seed_symbols.iter().take(8).map(|name| json!({ "name": name })).collect(),
            Vec::new(),
            sorted_hash_set_strings(&affected_files),
            related_tests,
            vec![
                "upstream callers",
                "permission and approval boundary",
                "tool result and evidence recording",
                "related tests",
            ],
            suggested_minimal_reads,
            Vec::new(),
        ),
    });

    json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&result).unwrap_or_default()
        }]
    })
}

fn find_related_tests(changed_files: &HashSet<String>, affected_files: &HashSet<String>, idx: &Index) -> Vec<String> {
    const GENERIC_STEMS: &[&str] = &["index", "main", "mod", "lib", "utils", "helpers", "types", "common", "constants", "config"];

    let mut tests: HashSet<String> = HashSet::new();
    let root_str = idx.root.to_string_lossy().to_string();
    let all_files: Vec<String> = idx.files().map(|e| make_relative(&e.path.to_string_lossy(), &root_str)).collect();

    let all_source_files: HashSet<&String> = changed_files.union(affected_files).collect();

    for src in &all_source_files {
        let src_path = PathBuf::from(src);
        let stem = match src_path.file_stem() {
            Some(s) => s.to_string_lossy().to_string(),
            None => continue,
        };
        let stem_clean = stem.trim_end_matches(".test")
            .trim_end_matches(".spec")
            .trim_end_matches("_test")
            .trim_end_matches("_spec");

        let is_generic = GENERIC_STEMS.contains(&stem_clean);
        let src_dir = src_path.parent()
            .map(|p| normalize_path(&p.to_string_lossy()))
            .unwrap_or_default();

        for candidate in &all_files {
            let cand_name = PathBuf::from(candidate)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let is_test = cand_name.contains(".test.") || cand_name.contains(".spec.")
                || cand_name.contains("_test.") || cand_name.contains("_spec.")
                || cand_name.starts_with("test_");
            if !is_test {
                continue;
            }
            if is_generic {
                let cand_dir = PathBuf::from(candidate).parent()
                    .map(|p| normalize_path(&p.to_string_lossy()))
                    .unwrap_or_default();
                if cand_dir == src_dir && cand_name.contains(stem_clean) {
                    tests.insert(candidate.clone());
                }
            } else if cand_name.contains(stem_clean) {
                tests.insert(candidate.clone());
            }
        }
    }

    let mut result: Vec<String> = tests.into_iter().collect();
    result.sort();
    result
}

fn sorted_hash_set_strings(values: &HashSet<String>) -> Vec<String> {
    let mut result: Vec<String> = values.iter().cloned().collect();
    result.sort();
    result
}

fn read_hint(file: String, line: usize, reason: &str) -> Value {
    json!({
        "file": file,
        "line": line.max(1),
        "max_lines": 80,
        "reason": reason,
    })
}

fn push_read_hint_unique(values: &mut Vec<Value>, file: String, line: usize, reason: &str) {
    if file.is_empty() {
        return;
    }
    let line = line.max(1);
    if values.iter().any(|value| {
        value.get("file").and_then(|v| v.as_str()) == Some(file.as_str())
            && value.get("line").and_then(|v| v.as_u64()) == Some(line as u64)
    }) {
        return;
    }
    values.push(read_hint(file, line, reason));
}

fn build_answer_pack(
    mode: &str,
    confidence: &str,
    entry_points: Vec<Value>,
    caller_chain: Vec<Value>,
    affected_files: Vec<String>,
    related_tests: Vec<String>,
    risk_areas: Vec<&str>,
    suggested_minimal_reads: Vec<Value>,
    missing_evidence: Vec<&str>,
) -> Value {
    json!({
        "mode": mode,
        "confidence": confidence,
        "entry_points": entry_points,
        "caller_chain": caller_chain,
        "affected_files": affected_files,
        "related_tests": related_tests,
        "risk_areas": risk_areas,
        "suggested_minimal_reads": suggested_minimal_reads,
        "missing_evidence": missing_evidence,
    })
}

fn normalize_path(p: &str) -> String {
    p.replace('\\', "/")
}

fn make_relative(path: &str, root: &str) -> String {
    let p = normalize_path(path);
    let r = normalize_path(root).trim_end_matches('/').to_string();
    if p.starts_with(&r) {
        let rel = &p[r.len()..];
        rel.trim_start_matches('/').to_string()
    } else {
        p
    }
}

fn handle_pre_plan(arguments: &Value, index: &mut Option<Index>) -> Value {
    let idx = match index.as_mut() {
        Some(i) => i,
        None => return tool_error("index not initialized — send initialize with rootUri first"),
    };
    idx.refresh();
    let root_str = idx.root.to_string_lossy().to_string();

    let target_files: Vec<String> = arguments
        .get("target_files")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|s| s.as_str().map(|x| make_relative(x, &root_str))).collect())
        .unwrap_or_default();

    let target_symbols: Vec<String> = arguments
        .get("target_symbols")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|s| s.as_str().map(String::from)).collect())
        .unwrap_or_default();

    let mut scope_files: HashSet<String> = target_files.iter().cloned().collect();

    if !target_symbols.is_empty() {
        for entry in idx.files() {
            let rel = make_relative(&entry.path.to_string_lossy(), &root_str);
            let defs = symbols::extract_definitions(&entry.tree, &entry.source, &entry.path, entry.lang);
            for d in &defs {
                if target_symbols.contains(&d.name) {
                    scope_files.insert(rel.clone());
                }
            }
        }
    }

    if scope_files.is_empty() {
        return handle_pre_plan_discovery(arguments, idx, &root_str);
    }

    let mut file_deps: HashMap<String, HashSet<String>> = HashMap::new();
    for file in &scope_files {
        file_deps.insert(file.clone(), HashSet::new());
    }

    let all_defs: HashMap<String, String> = idx.files().flat_map(|entry| {
        let rel = make_relative(&entry.path.to_string_lossy(), &root_str);
        symbols::extract_definitions(&entry.tree, &entry.source, &entry.path, entry.lang)
            .into_iter()
            .map(move |d| (d.name, rel.clone()))
    }).collect();

    for entry in idx.files() {
        let rel = make_relative(&entry.path.to_string_lossy(), &root_str);
        if !scope_files.contains(&rel) {
            continue;
        }
        let defs = symbols::extract_definitions(&entry.tree, &entry.source, &entry.path, entry.lang);
        for d in &defs {
            let callees = symbols::extract_callees(&entry.tree, &entry.source, &entry.path, &d.name, entry.lang);
            for callee in &callees {
                if let Some(def_file) = all_defs.get(&callee.name) {
                    if def_file != &rel && scope_files.contains(def_file) {
                        file_deps.get_mut(&rel).map(|deps| deps.insert(def_file.clone()));
                    }
                }
            }
        }
    }

    let edit_order = topological_sort(&file_deps);
    let related_tests = find_related_tests(&scope_files, &HashSet::new(), idx);

    let steps: Vec<Value> = edit_order.iter().enumerate().map(|(i, file)| {
        let deps: Vec<&String> = file_deps.get(file).map(|s| s.iter().collect()).unwrap_or_default();
        json!({
            "order": i + 1,
            "file": file,
            "depends_on": deps,
        })
    }).collect();

    let task = arguments.get("task").and_then(|s| s.as_str()).unwrap_or("");
    let mut suggested_minimal_reads: Vec<Value> = edit_order
        .iter()
        .map(|file| read_hint(file.clone(), 1, "planned edit file"))
        .collect();
    for test in related_tests.iter().take(6) {
        push_read_hint_unique(&mut suggested_minimal_reads, test.clone(), 1, "related test");
    }
    let result = json!({
        "task": task,
        "edit_order": steps,
        "total_files": scope_files.len(),
        "related_tests": related_tests,
        "answer_pack": build_answer_pack(
            "plan",
            "high",
            target_symbols.iter().take(8).map(|name| json!({ "name": name })).collect(),
            Vec::new(),
            edit_order.clone(),
            related_tests,
            vec![
                "file edit order",
                "cross-file dependency order",
                "related tests",
            ],
            suggested_minimal_reads,
            Vec::new(),
        ),
    });

    json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&result).unwrap_or_default()
        }]
    })
}

fn handle_pre_plan_discovery(arguments: &Value, idx: &Index, root_str: &str) -> Value {
    let task = arguments.get("task").and_then(|s| s.as_str()).unwrap_or("");
    let task_terms = tokenize_identifier(task);
    let mut candidates: HashMap<String, PlanCandidate> = HashMap::new();
    let file_entries: Vec<_> = idx.files().collect();

    for entry in &file_entries {
        let rel = make_relative(&entry.path.to_string_lossy(), root_str);
        for d in symbols::extract_definitions(&entry.tree, &entry.source, &entry.path, entry.lang) {
            if !is_discovery_anchor_candidate(&d.name, &rel) {
                continue;
            }
            candidates
                .entry(d.name.clone())
                .or_insert_with(|| {
                    PlanCandidate::new(
                        d.name.clone(),
                        rel.clone(),
                        d.line,
                        format!("{:?}", d.kind),
                        relevance_score(task, &task_terms, &d.name, &rel),
                    )
                });
        }
    }

    for entry in &file_entries {
        let rel = make_relative(&entry.path.to_string_lossy(), root_str);
        for d in symbols::extract_definitions(&entry.tree, &entry.source, &entry.path, entry.lang) {
            if !is_discovery_anchor_candidate(&d.name, &rel) {
                continue;
            }
            let callees = symbols::extract_callees(&entry.tree, &entry.source, &entry.path, &d.name, entry.lang);
            if let Some(candidate) = candidates.get_mut(&d.name) {
                candidate.callee_count += callees.len();
            }
            for callee in callees {
                if is_builtin_or_common(&callee.name) {
                    continue;
                }
                if let Some(candidate) = candidates.get_mut(&callee.name) {
                    candidate.caller_count += 1;
                    candidate.related_files.insert(rel.clone());
                }
            }
        }
    }

    let mut ranked: Vec<PlanCandidate> = candidates.into_values().collect();
    ranked.sort_by(|a, b| {
        b.relevance
            .cmp(&a.relevance)
            .then_with(|| b.score()
            .cmp(&a.score())
            )
            .then_with(|| a.file.cmp(&b.file))
            .then_with(|| a.name.cmp(&b.name))
    });
    ranked.truncate(8);

    let anchor_symbols: Vec<Value> = ranked
        .iter()
        .map(|c| json!({
            "name": &c.name,
            "file": &c.file,
            "line": c.line,
            "kind": &c.kind,
            "score": c.score(),
            "relevance": c.relevance,
            "caller_count": c.caller_count,
            "callee_count": c.callee_count,
        }))
        .collect();

    let mut candidate_files: Vec<String> = ranked.iter().map(|c| c.file.clone()).collect();
    candidate_files.sort();
    candidate_files.dedup();

    let suggested_calls: Vec<Value> = ranked
        .iter()
        .take(4)
        .map(|c| json!({
            "tool": "pre_context",
            "arguments": {
                "symbol": &c.name,
                "depth": 2
            },
            "reason": "high centrality AST anchor",
        }))
        .collect();

    let candidate_file_set: HashSet<String> = candidate_files.iter().cloned().collect();
    let related_tests = find_related_tests(&candidate_file_set, &HashSet::new(), idx);
    let mut suggested_minimal_reads: Vec<Value> = ranked
        .iter()
        .take(8)
        .map(|c| read_hint(c.file.clone(), c.line, "candidate anchor"))
        .collect();
    for test in related_tests.iter().take(6) {
        push_read_hint_unique(&mut suggested_minimal_reads, test.clone(), 1, "related test");
    }
    let missing_evidence = if ranked.is_empty() {
        vec!["anchor_symbols"]
    } else {
        Vec::new()
    };
    let confidence = if ranked.is_empty() {
        "low"
    } else if ranked.iter().any(|c| c.relevance > 0) {
        "high"
    } else {
        "medium"
    };

    let result = json!({
        "task": task,
        "mode": "discovery",
        "anchor_symbols": anchor_symbols,
        "candidate_files": candidate_files,
        "suggested_calls": suggested_calls,
        "related_tests": related_tests,
        "risk_areas": [
            "tool definition schema",
            "model tool dispatch",
            "tool result and evidence recording",
            "prompt/runtime tool visibility"
        ],
        "answer_pack": build_answer_pack(
            "discovery",
            confidence,
            anchor_symbols,
            Vec::new(),
            candidate_files,
            related_tests,
            vec![
                "tool definition schema",
                "model tool dispatch",
                "tool result and evidence recording",
                "prompt/runtime tool visibility",
            ],
            suggested_minimal_reads,
            missing_evidence,
        ),
    });

    json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&result).unwrap_or_default()
        }]
    })
}

struct PlanCandidate {
    name: String,
    file: String,
    line: usize,
    kind: String,
    relevance: usize,
    caller_count: usize,
    callee_count: usize,
    related_files: HashSet<String>,
}

impl PlanCandidate {
    fn new(name: String, file: String, line: usize, kind: String, relevance: usize) -> Self {
        Self {
            name,
            file,
            line,
            kind,
            relevance,
            caller_count: 0,
            callee_count: 0,
            related_files: HashSet::new(),
        }
    }

    fn score(&self) -> usize {
        self.relevance * 20 + self.caller_count * 3 + self.callee_count + self.related_files.len()
    }
}

fn relevance_score(task: &str, task_terms: &HashSet<String>, name: &str, file: &str) -> usize {
    if task_terms.is_empty() {
        return 0;
    }

    let mut score = 0;
    let task_lower = task.to_ascii_lowercase();
    let name_lower = name.to_ascii_lowercase();
    if name.len() >= 4 && task_lower.contains(&name_lower) {
        score += 10;
    }

    for term in tokenize_identifier(name).union(&tokenize_identifier(file)) {
        if task_terms.contains(term) && !is_builtin_or_common(term) {
            score += 1;
        }
    }
    score
}

fn tokenize_identifier(text: &str) -> HashSet<String> {
    let mut terms = HashSet::new();
    let mut current = String::new();
    let mut prev_lower_or_digit = false;

    for ch in text.chars() {
        if ch.is_ascii_alphanumeric() {
            if ch.is_ascii_uppercase() && prev_lower_or_digit && !current.is_empty() {
                insert_token(&mut terms, &current);
                current.clear();
            }
            prev_lower_or_digit = ch.is_ascii_lowercase() || ch.is_ascii_digit();
            current.push(ch.to_ascii_lowercase());
        } else {
            insert_token(&mut terms, &current);
            current.clear();
            prev_lower_or_digit = false;
        }
    }
    insert_token(&mut terms, &current);
    terms
}

fn insert_token(terms: &mut HashSet<String>, token: &str) {
    if token.len() >= 3 {
        terms.insert(token.to_string());
    }
}

fn is_discovery_anchor_candidate(name: &str, file: &str) -> bool {
    if is_builtin_or_common(name) || is_generic_anchor_name(name) {
        return false;
    }
    let file = normalize_path(file);
    let file_name = PathBuf::from(&file)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    !(file.contains("/fixtures/")
        || file.contains("/testdata/")
        || file_name.contains(".test.")
        || file_name.contains(".spec.")
        || file_name.contains("_test.")
        || file_name.contains("_spec.")
        || file_name.starts_with("test_"))
}

fn is_generic_anchor_name(name: &str) -> bool {
    matches!(
        name,
        "execute"
            | "files"
            | "target"
            | "deps"
            | "options"
            | "config"
            | "handler"
            | "run"
            | "start"
            | "stop"
    )
}

fn topological_sort(deps: &HashMap<String, HashSet<String>>) -> Vec<String> {
    let mut in_degree: HashMap<&String, usize> = HashMap::new();
    let mut dependents: HashMap<&String, Vec<&String>> = HashMap::new();
    for key in deps.keys() {
        in_degree.entry(key).or_insert(0);
        dependents.entry(key).or_insert_with(Vec::new);
    }
    for (node, edges) in deps.iter() {
        for dep in edges {
            if deps.contains_key(dep) {
                dependents.entry(dep).or_insert_with(Vec::new).push(node);
            }
        }
        *in_degree.entry(node).or_insert(0) = edges.iter().filter(|d| deps.contains_key(*d)).count();
    }

    let mut queue: VecDeque<&String> = in_degree
        .iter()
        .filter(|(_, &deg)| deg == 0)
        .map(|(k, _)| *k)
        .collect();
    let mut sorted: Vec<String> = Vec::new();

    while let Some(node) = queue.pop_front() {
        sorted.push(node.clone());
        if let Some(deps_of_node) = dependents.get(node) {
            for dependent in deps_of_node {
                if let Some(count) = in_degree.get_mut(dependent) {
                    *count = count.saturating_sub(1);
                    if *count == 0 {
                        queue.push_back(dependent);
                    }
                }
            }
        }
    }

    for key in deps.keys() {
        if !sorted.contains(key) {
            sorted.push(key.clone());
        }
    }

    sorted
}

fn handle_pre_verify(arguments: &Value, index: &mut Option<Index>, deep_layer: &mut Option<ts_deep_layer::DeepLayer>, py_layer: &mut Option<py_deep_layer::PyDeepLayer>, rust_layer: &mut Option<rust_deep_layer::RustDeepLayer>, go_layer: &mut Option<go_deep_layer::GoDeepLayer>, java_layer: &mut Option<java_deep_layer::JavaDeepLayer>, sql_layer: &mut Option<sql_deep_layer::SqlDeepLayer>, shell_layer: &mut Option<shell_deep_layer::ShellDeepLayer>, csharp_layer: &mut Option<csharp_deep_layer::CsharpDeepLayer>, php_layer: &mut Option<php_deep_layer::PhpDeepLayer>, ruby_layer: &mut Option<ruby_deep_layer::RubyDeepLayer>, kotlin_layer: &mut Option<kotlin_deep_layer::KotlinDeepLayer>) -> Value {
    let idx = match index.as_mut() {
        Some(i) => i,
        None => return tool_error("index not initialized — send initialize with rootUri first"),
    };
    let t0 = std::time::Instant::now();
    idx.refresh();
    let refresh_ms = t0.elapsed().as_millis();
    let root_str = idx.root.to_string_lossy().to_string();

    let changed_files: Vec<String> = arguments
        .get("changed_files")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|s| s.as_str().map(|x| make_relative(x, &root_str))).collect())
        .unwrap_or_default();

    if changed_files.is_empty() {
        return tool_error("changed_files array is required and must not be empty");
    }

    let t1 = std::time::Instant::now();

    let all_defs = idx.all_defs();

    let mut issues: Vec<Value> = Vec::new();

    for entry in idx.files() {
        let rel = make_relative(&entry.path.to_string_lossy(), &root_str);
        if !changed_files.contains(&rel) {
            continue;
        }
        let imported = symbols::extract_imports(&entry.tree, &entry.source, entry.lang);
        let local_bindings = symbols::extract_local_bindings(&entry.tree, &entry.source);
        let fn_callees = symbols::extract_all_callees_grouped(&entry.tree, &entry.source, &entry.path, entry.lang);
        for (fn_name, callees) in &fn_callees {
            for callee in callees {
                if callee.is_member
                    || imported.contains(&callee.name)
                    || local_bindings.contains(&callee.name)
                    || is_builtin_or_common(&callee.name)
                {
                    continue;
                }
                if let Some(&param_count) = all_defs.get(&callee.name) {
                    if callee.arg_count > param_count {
                        issues.push(json!({
                            "type": "argument_count_mismatch",
                            "file": rel,
                            "function": fn_name,
                            "calls": callee.name,
                            "line": callee.line,
                            "expected": param_count,
                            "actual": callee.arg_count,
                        }));
                    }
                } else {
                    issues.push(json!({
                        "type": "unresolved_call",
                        "file": rel,
                        "function": fn_name,
                        "calls": callee.name,
                        "line": callee.line,
                    }));
                }
            }
        }
    }

    let verify_ms = t1.elapsed().as_millis();

    // TypeScript Deep Layer: type-level checking via subprocess
    let ts_files: Vec<String> = changed_files.iter()
        .filter(|f| f.ends_with(".ts") || f.ends_with(".tsx"))
        .cloned()
        .collect();
    let deep_result = if ts_files.is_empty() {
        ts_deep_layer::DeepLayerResult {
            issues: vec![],
            status: "disabled",
            reason: Some("no TypeScript files in changed_files".to_string()),
            elapsed_ms: 0,
        }
    } else {
        ts_deep_layer::run(deep_layer, &idx.root, &ts_files)
    };
    issues.extend(deep_result.issues);
    let deep_layer_ms = deep_result.elapsed_ms;
    let deep_layer_status = deep_result.status;
    let deep_layer_reason = deep_result.reason;

    // Python Deep Layer: type-level checking via pyright subprocess
    let py_files: Vec<String> = changed_files.iter()
        .filter(|f| f.ends_with(".py"))
        .cloned()
        .collect();
    let py_result = if py_files.is_empty() {
        py_deep_layer::PyDeepLayerResult {
            issues: vec![],
            status: "disabled",
            reason: Some("no Python files in changed_files".to_string()),
            elapsed_ms: 0,
        }
    } else {
        py_deep_layer::run(py_layer, &idx.root, &py_files)
    };
    issues.extend(py_result.issues);
    let py_deep_layer_ms = py_result.elapsed_ms;
    let py_deep_layer_status = py_result.status;
    let py_deep_layer_reason = py_result.reason;

    // Rust Deep Layer: type-level checking via cargo check subprocess
    let rs_files: Vec<String> = changed_files.iter()
        .filter(|f| f.ends_with(".rs"))
        .cloned()
        .collect();
    let rust_result = if rs_files.is_empty() {
        rust_deep_layer::RustDeepLayerResult {
            issues: vec![],
            status: "disabled",
            reason: Some("no Rust files in changed_files".to_string()),
            elapsed_ms: 0,
        }
    } else {
        rust_deep_layer::run(rust_layer, &idx.root, &rs_files)
    };
    issues.extend(rust_result.issues);
    let rust_deep_layer_ms = rust_result.elapsed_ms;
    let rust_deep_layer_status = rust_result.status;
    let rust_deep_layer_reason = rust_result.reason;

    // Go Deep Layer: type-level checking via gopls / go build subprocess
    let go_files: Vec<String> = changed_files.iter()
        .filter(|f| f.ends_with(".go"))
        .cloned()
        .collect();
    let go_result = if go_files.is_empty() {
        go_deep_layer::GoDeepLayerResult {
            issues: vec![],
            status: "disabled",
            reason: Some("no Go files in changed_files".to_string()),
            elapsed_ms: 0,
        }
    } else {
        go_deep_layer::run(go_layer, &idx.root, &go_files)
    };
    issues.extend(go_result.issues);
    let go_deep_layer_ms = go_result.elapsed_ms;
    let go_deep_layer_status = go_result.status;
    let go_deep_layer_reason = go_result.reason;

    // Java Deep Layer: type-level checking via jdtls / javac subprocess
    let java_files: Vec<String> = changed_files.iter()
        .filter(|f| f.ends_with(".java"))
        .cloned()
        .collect();
    let java_result = if java_files.is_empty() {
        java_deep_layer::JavaDeepLayerResult {
            issues: vec![],
            status: "disabled",
            reason: Some("no Java files in changed_files".to_string()),
            elapsed_ms: 0,
        }
    } else {
        java_deep_layer::run(java_layer, &idx.root, &java_files)
    };
    issues.extend(java_result.issues);
    let java_deep_layer_ms = java_result.elapsed_ms;
    let java_deep_layer_status = java_result.status;
    let java_deep_layer_reason = java_result.reason;

    // SQL Deep Layer: syntax/lint checking via sqlfluff / fallback
    let sql_files: Vec<String> = changed_files.iter()
        .filter(|f| f.ends_with(".sql"))
        .cloned()
        .collect();
    let sql_result = if sql_files.is_empty() {
        sql_deep_layer::SqlDeepLayerResult {
            issues: vec![],
            status: "disabled",
            reason: Some("no SQL files in changed_files".to_string()),
            elapsed_ms: 0,
        }
    } else {
        sql_deep_layer::run(sql_layer, &idx.root, &sql_files)
    };
    issues.extend(sql_result.issues);
    let sql_deep_layer_ms = sql_result.elapsed_ms;
    let sql_deep_layer_status = sql_result.status;
    let sql_deep_layer_reason = sql_result.reason;

    // Shell Deep Layer: shellcheck / fallback syntax checking
    let shell_files: Vec<String> = changed_files.iter()
        .filter(|f| f.ends_with(".sh") || f.ends_with(".bash") || f.ends_with(".zsh") || f.ends_with(".ksh"))
        .cloned()
        .collect();
    let shell_result = if shell_files.is_empty() {
        shell_deep_layer::ShellDeepLayerResult {
            issues: vec![],
            status: "disabled",
            reason: Some("no shell files in changed_files".to_string()),
            elapsed_ms: 0,
        }
    } else {
        shell_deep_layer::run(shell_layer, &idx.root, &shell_files)
    };
    issues.extend(shell_result.issues);
    let shell_deep_layer_ms = shell_result.elapsed_ms;
    let shell_deep_layer_status = shell_result.status;
    let shell_deep_layer_reason = shell_result.reason;

    // C# Deep Layer: dotnet build / fallback syntax checking
    let cs_files: Vec<String> = changed_files.iter()
        .filter(|f| f.ends_with(".cs"))
        .cloned()
        .collect();
    let csharp_result = if cs_files.is_empty() {
        csharp_deep_layer::CsharpDeepLayerResult {
            issues: vec![],
            status: "disabled",
            reason: Some("no C# files in changed_files".to_string()),
            elapsed_ms: 0,
        }
    } else {
        csharp_deep_layer::run(csharp_layer, &idx.root, &cs_files)
    };
    issues.extend(csharp_result.issues);
    let csharp_deep_layer_ms = csharp_result.elapsed_ms;
    let csharp_deep_layer_status = csharp_result.status;
    let csharp_deep_layer_reason = csharp_result.reason;

    // PHP Deep Layer: php -l / fallback syntax checking
    let php_files: Vec<String> = changed_files.iter()
        .filter(|f| f.ends_with(".php"))
        .cloned()
        .collect();
    let php_result = if php_files.is_empty() {
        php_deep_layer::PhpDeepLayerResult {
            issues: vec![],
            status: "disabled",
            reason: Some("no PHP files in changed_files".to_string()),
            elapsed_ms: 0,
        }
    } else {
        php_deep_layer::run(php_layer, &idx.root, &php_files)
    };
    issues.extend(php_result.issues);
    let php_deep_layer_ms = php_result.elapsed_ms;
    let php_deep_layer_status = php_result.status;
    let php_deep_layer_reason = php_result.reason;

    // Ruby Deep Layer: ruby -c syntax checking
    let ruby_files: Vec<String> = changed_files.iter()
        .filter(|f| f.ends_with(".rb"))
        .cloned()
        .collect();
    let ruby_result = if ruby_files.is_empty() {
        ruby_deep_layer::RubyDeepLayerResult {
            issues: vec![],
            status: "disabled",
            reason: Some("no Ruby files in changed_files".to_string()),
            elapsed_ms: 0,
        }
    } else {
        ruby_deep_layer::run(ruby_layer, &idx.root, &ruby_files)
    };
    issues.extend(ruby_result.issues);
    let ruby_deep_layer_ms = ruby_result.elapsed_ms;
    let ruby_deep_layer_status = ruby_result.status;
    let ruby_deep_layer_reason = ruby_result.reason;

    // Kotlin Deep Layer: kotlinc syntax/type checking
    let kotlin_files: Vec<String> = changed_files.iter()
        .filter(|f| f.ends_with(".kt") || f.ends_with(".kts"))
        .cloned()
        .collect();
    let kotlin_result = if kotlin_files.is_empty() {
        kotlin_deep_layer::KotlinDeepLayerResult {
            issues: vec![],
            status: "disabled",
            reason: Some("no Kotlin files in changed_files".to_string()),
            elapsed_ms: 0,
        }
    } else {
        kotlin_deep_layer::run(kotlin_layer, &idx.root, &kotlin_files)
    };
    issues.extend(kotlin_result.issues);
    let kotlin_deep_layer_ms = kotlin_result.elapsed_ms;
    let kotlin_deep_layer_status = kotlin_result.status;
    let kotlin_deep_layer_reason = kotlin_result.reason;

    let elapsed_ms = t0.elapsed().as_millis();
    let status = if issues.is_empty() { "pass" } else { "issues_found" };
    let result = json!({
        "status": status,
        "checked_files": changed_files.len(),
        "elapsed_ms": elapsed_ms,
        "refresh_ms": refresh_ms,
        "verify_ms": verify_ms,
        "deep_layer_ms": deep_layer_ms,
        "py_deep_layer_ms": py_deep_layer_ms,
        "rust_deep_layer_ms": rust_deep_layer_ms,
        "go_deep_layer_ms": go_deep_layer_ms,
        "java_deep_layer_ms": java_deep_layer_ms,
        "sql_deep_layer_ms": sql_deep_layer_ms,
        "shell_deep_layer_ms": shell_deep_layer_ms,
        "csharp_deep_layer_ms": csharp_deep_layer_ms,
        "php_deep_layer_ms": php_deep_layer_ms,
        "ruby_deep_layer_ms": ruby_deep_layer_ms,
        "kotlin_deep_layer_ms": kotlin_deep_layer_ms,
        "issues": issues,
        "deep_layer": {
            "status": deep_layer_status,
            "reason": deep_layer_reason,
        },
        "py_deep_layer": {
            "status": py_deep_layer_status,
            "reason": py_deep_layer_reason,
        },
        "rust_deep_layer": {
            "status": rust_deep_layer_status,
            "reason": rust_deep_layer_reason,
        },
        "go_deep_layer": {
            "status": go_deep_layer_status,
            "reason": go_deep_layer_reason,
        },
        "java_deep_layer": {
            "status": java_deep_layer_status,
            "reason": java_deep_layer_reason,
        },
        "sql_deep_layer": {
            "status": sql_deep_layer_status,
            "reason": sql_deep_layer_reason,
        },
        "shell_deep_layer": {
            "status": shell_deep_layer_status,
            "reason": shell_deep_layer_reason,
        },
        "csharp_deep_layer": {
            "status": csharp_deep_layer_status,
            "reason": csharp_deep_layer_reason,
        },
        "php_deep_layer": {
            "status": php_deep_layer_status,
            "reason": php_deep_layer_reason,
        },
        "ruby_deep_layer": {
            "status": ruby_deep_layer_status,
            "reason": ruby_deep_layer_reason,
        },
        "kotlin_deep_layer": {
            "status": kotlin_deep_layer_status,
            "reason": kotlin_deep_layer_reason,
        },
    });

    json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&result).unwrap_or_default()
        }]
    })
}

fn is_builtin_or_common(name: &str) -> bool {
    let builtins = [
        "console", "log", "warn", "error", "info", "debug",
        "setTimeout", "setInterval", "clearTimeout", "clearInterval",
        "parseInt", "parseFloat", "isNaN", "isFinite",
        "JSON", "parse", "stringify",
        "Object", "keys", "values", "entries", "assign", "freeze", "create", "defineProperty",
        "Array", "from", "isArray", "map", "filter", "reduce", "forEach", "find", "some", "every",
        "push", "pop", "shift", "unshift", "slice", "splice", "concat", "join", "includes", "indexOf",
        "flat", "flatMap", "fill", "sort", "reverse", "at", "findIndex",
        "String", "toString", "trim", "trimStart", "trimEnd", "split", "replace", "replaceAll",
        "match", "matchAll", "startsWith", "endsWith", "padStart", "padEnd", "repeat", "charAt",
        "toLowerCase", "toUpperCase", "toLocaleLowerCase", "toLocaleUpperCase", "normalize",
        "substring", "charCodeAt", "codePointAt",
        "Promise", "resolve", "reject", "then", "catch", "finally", "all", "race", "allSettled",
        "Math", "min", "max", "floor", "ceil", "round", "abs", "random", "pow", "sqrt",
        "Date", "now", "getTime", "toISOString", "toJSON", "toDateString", "toTimeString",
        "Number", "toFixed", "toPrecision",
        "Boolean",
        "RegExp", "test", "exec",
        "Map", "Set", "WeakMap", "WeakSet",
        "Symbol", "iterator",
        "Buffer", "byteLength", "allocUnsafe", "alloc",
        "crypto", "randomUUID", "getRandomValues",
        "require", "import",
        "typeof", "instanceof",
        "println", "eprintln", "format", "vec", "print", "panic",
        "len", "append", "make", "new", "close", "open", "read", "write",
        "get", "set", "has", "delete", "clear", "size",
        "emit", "on", "once", "off", "removeListener", "addEventListener", "removeEventListener",
        "next", "done", "return",
        "apply", "call", "bind",
        "hasOwnProperty", "propertyIsEnumerable", "isPrototypeOf", "valueOf",
    ];
    builtins.contains(&name)
}

fn tool_error(msg: &str) -> Value {
    json!({
        "content": [{
            "type": "text",
            "text": msg
        }],
        "isError": true
    })
}
