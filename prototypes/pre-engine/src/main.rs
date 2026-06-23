mod index;
mod language;
mod symbols;

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
        if let Some(response) = handle_request(&request, &mut index) {
            let out = serde_json::to_string(&response).unwrap();
            writeln!(stdout_lock, "{}", out).ok();
            stdout_lock.flush().ok();
        }
    }
}

fn handle_request(request: &Value, index: &mut Option<Index>) -> Option<Value> {
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
            let result = handle_tool_call(tool_name, &arguments, index);
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

fn handle_tool_call(tool_name: &str, arguments: &Value, index: &mut Option<Index>) -> Value {
    match tool_name {
        "pre_context" => {
            let symbol = arguments.get("symbol").and_then(|s| s.as_str()).unwrap_or("");
            if symbol.is_empty() {
                return tool_error("symbol is required");
            }
            if let Some(idx) = index.as_mut() {
                idx.refresh();
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
                let result = json!({
                    "definition": definition,
                    "references": refs_json,
                    "callees": callees_json,
                    "callers": callers_json,
                    "signature": definitions.first().map(|d| d.signature.as_str()).unwrap_or(""),
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
            handle_pre_verify(arguments, index)
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

    let result = json!({
        "affected_files": affected_files.iter().collect::<Vec<_>>(),
        "affected_functions": affected_functions,
        "related_tests": related_tests,
        "seed_symbols": seed_symbols,
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
        return tool_error("no target_files or target_symbols resolved to any indexed files");
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

    let steps: Vec<Value> = edit_order.iter().enumerate().map(|(i, file)| {
        let deps: Vec<&String> = file_deps.get(file).map(|s| s.iter().collect()).unwrap_or_default();
        json!({
            "order": i + 1,
            "file": file,
            "depends_on": deps,
        })
    }).collect();

    let task = arguments.get("task").and_then(|s| s.as_str()).unwrap_or("");
    let result = json!({
        "task": task,
        "edit_order": steps,
        "total_files": scope_files.len(),
    });

    json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&result).unwrap_or_default()
        }]
    })
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

fn handle_pre_verify(arguments: &Value, index: &mut Option<Index>) -> Value {
    let idx = match index.as_mut() {
        Some(i) => i,
        None => return tool_error("index not initialized — send initialize with rootUri first"),
    };
    idx.refresh();
    let root_str = idx.root.to_string_lossy().to_string();

    let changed_files: Vec<String> = arguments
        .get("changed_files")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|s| s.as_str().map(|x| make_relative(x, &root_str))).collect())
        .unwrap_or_default();

    if changed_files.is_empty() {
        return tool_error("changed_files array is required and must not be empty");
    }

    let all_defs: HashSet<String> = idx.files().flat_map(|entry| {
        symbols::extract_definitions(&entry.tree, &entry.source, &entry.path, entry.lang)
            .into_iter()
            .map(|d| d.name)
    }).collect();

    let mut issues: Vec<Value> = Vec::new();

    for entry in idx.files() {
        let rel = make_relative(&entry.path.to_string_lossy(), &root_str);
        if !changed_files.contains(&rel) {
            continue;
        }
        let imported = symbols::extract_imports(&entry.tree, &entry.source, entry.lang);
        let defs = symbols::extract_definitions(&entry.tree, &entry.source, &entry.path, entry.lang);
        for d in &defs {
            let callees = symbols::extract_callees(&entry.tree, &entry.source, &entry.path, &d.name, entry.lang);
            for callee in &callees {
                if callee.is_member || imported.contains(&callee.name) {
                    continue;
                }
                if !all_defs.contains(&callee.name) && !is_builtin_or_common(&callee.name) {
                    issues.push(json!({
                        "type": "unresolved_call",
                        "file": rel,
                        "function": d.name,
                        "calls": callee.name,
                        "line": callee.line,
                    }));
                }
            }
        }
    }

    let status = if issues.is_empty() { "pass" } else { "issues_found" };
    let result = json!({
        "status": status,
        "checked_files": changed_files.len(),
        "issues": issues,
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
