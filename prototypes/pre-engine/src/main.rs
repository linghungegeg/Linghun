#![recursion_limit = "256"]

mod cpp_deep_layer;
mod csharp_deep_layer;
mod dart_deep_layer;
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
mod swift_deep_layer;
mod symbols;
mod ts_deep_layer;

use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};

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
    let mut dart_layer: Option<dart_deep_layer::DartDeepLayer> = None;
    let mut swift_layer: Option<swift_deep_layer::SwiftDeepLayer> = None;
    let mut cpp_layer: Option<cpp_deep_layer::CppDeepLayer> = None;

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
        if let Some(response) = handle_request(&request, &mut index, &mut deep_layer, &mut py_layer, &mut rust_layer, &mut go_layer, &mut java_layer, &mut sql_layer, &mut shell_layer, &mut csharp_layer, &mut php_layer, &mut ruby_layer, &mut kotlin_layer, &mut dart_layer, &mut swift_layer, &mut cpp_layer) {
            let out = serde_json::to_string(&response).unwrap();
            writeln!(stdout_lock, "{}", out).ok();
            stdout_lock.flush().ok();
        }
    }
}

fn handle_request(request: &Value, index: &mut Option<Index>, deep_layer: &mut Option<ts_deep_layer::DeepLayer>, py_layer: &mut Option<py_deep_layer::PyDeepLayer>, rust_layer: &mut Option<rust_deep_layer::RustDeepLayer>, go_layer: &mut Option<go_deep_layer::GoDeepLayer>, java_layer: &mut Option<java_deep_layer::JavaDeepLayer>, sql_layer: &mut Option<sql_deep_layer::SqlDeepLayer>, shell_layer: &mut Option<shell_deep_layer::ShellDeepLayer>, csharp_layer: &mut Option<csharp_deep_layer::CsharpDeepLayer>, php_layer: &mut Option<php_deep_layer::PhpDeepLayer>, ruby_layer: &mut Option<ruby_deep_layer::RubyDeepLayer>, kotlin_layer: &mut Option<kotlin_deep_layer::KotlinDeepLayer>, dart_layer: &mut Option<dart_deep_layer::DartDeepLayer>, swift_layer: &mut Option<swift_deep_layer::SwiftDeepLayer>, cpp_layer: &mut Option<cpp_deep_layer::CppDeepLayer>) -> Option<Value> {
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
            let root_str = idx.root.to_string_lossy().to_string();
            let ts_files: Vec<String> = idx
                .files()
                .filter(|entry| {
                    matches!(entry.lang, language::Lang::TypeScript | language::Lang::Tsx)
                })
                .map(|entry| make_relative(&entry.path.to_string_lossy(), &root_str))
                .collect();
            if !ts_files.is_empty() {
                ts_deep_layer::prepare(deep_layer, &idx.root, &[]);
            }
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
            let result = handle_tool_call(tool_name, &arguments, index, deep_layer, py_layer, rust_layer, go_layer, java_layer, sql_layer, shell_layer, csharp_layer, php_layer, ruby_layer, kotlin_layer, dart_layer, swift_layer, cpp_layer);
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
            "description": "仅对 AST 索引语言查询符号定义、引用和调用关系；仅验证语言不支持结构上下文。结果会声明逐语言能力、置信度和缺失证据。",
            "language_capabilities": language_capability_summary("pre_context"),
            "inputSchema": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "symbol": { "type": "string" },
                    "path": { "type": "string" },
                    "depth": { "type": "number" }
                },
                "required": ["symbol"]
            }
        }),
        json!({
            "name": "pre_impact",
            "description": "仅对 AST 索引语言分析变更影响，返回候选文件、函数和测试；不对仅验证语言声称结构覆盖。",
            "language_capabilities": language_capability_summary("pre_impact"),
            "inputSchema": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "changes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": false,
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
            "description": "仅依据 AST 索引语言的结构证据生成候选编辑顺序和依赖约束；输出不是编译器级语义保证。",
            "language_capabilities": language_capability_summary("pre_plan"),
            "inputSchema": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "task": { "type": "string" },
                    "target_symbols": { "type": "array", "items": { "type": "string" } },
                    "target_files": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["task"]
            }
        }),
        json!({
            "name": "pre_verify",
            "description": "按语言执行可用的 AST、外部或降级验证。必须依据 verification.status 区分 verified、partially_verified、fallback_used、tool_missing 和 not_covered；降级或工具缺失不得表述为完整验证通过。",
            "language_capabilities": language_capability_summary("pre_verify"),
            "inputSchema": {
                "type": "object",
                "additionalProperties": false,
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

fn language_capability_summary(tool_name: &str) -> Value {
    let languages: Vec<&language::LanguageCapability> = language::LANGUAGE_CAPABILITIES
        .iter()
        .filter(|capability| capability_supports_tool(capability, tool_name))
        .collect();
    let supported_languages: Vec<&str> = languages
        .iter()
        .map(|capability| capability.language)
        .collect();

    json!({
        "tool": tool_name,
        "supported_languages": supported_languages,
        "languages": languages,
    })
}

fn capability_supports_tool(capability: &language::LanguageCapability, tool_name: &str) -> bool {
    if tool_name != "pre_verify"
        && capability.current_status != language::CurrentStatus::ProductGrade
    {
        return false;
    }
    match tool_name {
        "pre_context" => capability.context == language::CapabilitySupport::Supported,
        "pre_plan" => capability.plan == language::CapabilitySupport::Supported,
        "pre_impact" => capability.impact == language::CapabilitySupport::Supported,
        "pre_verify" => true,
        _ => false,
    }
}

fn compact_language_capability_summary(tool_name: &str) -> Value {
    let supported_languages: Vec<&str> = language::LANGUAGE_CAPABILITIES
        .iter()
        .filter(|capability| capability_supports_tool(capability, tool_name))
        .map(|capability| capability.language)
        .collect();
    let partial_languages: Vec<&str> = language::LANGUAGE_CAPABILITIES
        .iter()
        .filter(|capability| {
            capability_supports_tool(capability, tool_name)
                && capability.current_status == language::CurrentStatus::Partial
        })
        .map(|capability| capability.language)
        .collect();
    let verify_only_languages: Vec<&str> = language::LANGUAGE_CAPABILITIES
        .iter()
        .filter(|capability| {
            capability_supports_tool(capability, tool_name)
                && capability.support_tier == language::SupportTier::VerifyOnly
        })
        .map(|capability| capability.language)
        .collect();

    json!({
        "tool": tool_name,
        "supported_languages": supported_languages,
        "partial_languages": partial_languages,
        "verify_only_languages": verify_only_languages,
    })
}

fn tool_success(tool_name: &str, mut result: Value) -> Value {
    if let Some(object) = result.as_object_mut() {
        object.insert(
            "capability_summary".to_string(),
            compact_language_capability_summary(tool_name),
        );
    }

    json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&result).unwrap_or_default()
        }]
    })
}

fn reject_non_structural_paths(tool_name: &str, paths: &[String]) -> Option<Value> {
    let unsupported_paths: Vec<Value> = paths
        .iter()
        .filter_map(|path| match language::capability_for_path(path) {
            Some(capability) if capability.ast_indexed => None,
            Some(capability) => Some(json!({
                "path": path,
                "language": capability.language,
                "support_tier": capability.support_tier,
                "reason": "structural_analysis_not_supported",
            })),
            None => Some(json!({
                "path": path,
                "language": null,
                "reason": "unregistered_language",
            })),
        })
        .collect();

    if unsupported_paths.is_empty() {
        return None;
    }

    Some(tool_success(tool_name, json!({
        "status": "not_covered",
        "confidence": "low",
        "unsupported_paths": unsupported_paths,
        "missing_evidence": ["structural_analysis_not_supported"],
    })))
}

fn parse_errors_for_paths(
    idx: &Index,
    paths: &HashSet<String>,
    root_str: &str,
) -> Vec<String> {
    let mut parse_errors: Vec<String> = idx
        .files()
        .filter(|entry| entry.parse_error)
        .map(|entry| make_relative(&entry.path.to_string_lossy(), root_str))
        .filter(|path| paths.contains(path))
        .collect();
    parse_errors.sort();
    parse_errors.dedup();
    parse_errors
}

fn sorted_relation_values(
    relations: &HashMap<String, ts_deep_layer::SymbolRelations>,
    select: fn(&ts_deep_layer::SymbolRelations) -> &[String],
) -> Vec<String> {
    let mut values: Vec<String> = relations
        .values()
        .flat_map(|relation| select(relation).iter().cloned())
        .collect();
    values.sort();
    values.dedup();
    values
}

fn ambiguous_definition_symbols(idx: &Index, target_symbols: &[String]) -> Vec<String> {
    let targets: HashSet<&str> = target_symbols.iter().map(String::as_str).collect();
    let mut counts: HashMap<String, usize> = HashMap::new();
    for entry in idx.files().filter(|entry| {
        !matches!(entry.lang, language::Lang::TypeScript | language::Lang::Tsx | language::Lang::Python | language::Lang::Rust | language::Lang::Go | language::Lang::Java)
    }) {
        for definition in
            symbols::extract_definitions(&entry.tree, &entry.source, &entry.path, entry.lang)
        {
            if targets.contains(definition.name.as_str()) {
                *counts.entry(definition.name).or_default() += 1;
            }
        }
    }
    let mut ambiguous: Vec<String> = counts
        .into_iter()
        .filter_map(|(name, count)| (count > 1).then_some(name))
        .collect();
    ambiguous.sort();
    ambiguous
}

fn handle_tool_call(tool_name: &str, arguments: &Value, index: &mut Option<Index>, deep_layer: &mut Option<ts_deep_layer::DeepLayer>, py_layer: &mut Option<py_deep_layer::PyDeepLayer>, rust_layer: &mut Option<rust_deep_layer::RustDeepLayer>, go_layer: &mut Option<go_deep_layer::GoDeepLayer>, java_layer: &mut Option<java_deep_layer::JavaDeepLayer>, sql_layer: &mut Option<sql_deep_layer::SqlDeepLayer>, shell_layer: &mut Option<shell_deep_layer::ShellDeepLayer>, csharp_layer: &mut Option<csharp_deep_layer::CsharpDeepLayer>, php_layer: &mut Option<php_deep_layer::PhpDeepLayer>, ruby_layer: &mut Option<ruby_deep_layer::RubyDeepLayer>, kotlin_layer: &mut Option<kotlin_deep_layer::KotlinDeepLayer>, dart_layer: &mut Option<dart_deep_layer::DartDeepLayer>, swift_layer: &mut Option<swift_deep_layer::SwiftDeepLayer>, cpp_layer: &mut Option<cpp_deep_layer::CppDeepLayer>) -> Value {
    match tool_name {
        "pre_context" => {
            let symbol = arguments.get("symbol").and_then(|s| s.as_str()).unwrap_or("");
            if symbol.is_empty() {
                return tool_error("symbol is required");
            }
            let requested_paths: Vec<String> = arguments
                .get("path")
                .and_then(Value::as_str)
                .map(|path| vec![path.to_string()])
                .unwrap_or_default();
            if let Some(result) = reject_non_structural_paths("pre_context", &requested_paths) {
                return result;
            }
            if let Some(idx) = index.as_mut() {
                let root_str = idx.root.to_string_lossy().to_string();
                let (accepted_requested_paths, mut outside_workspace_files, index_consistency) = if requested_paths.is_empty() {
                    (
                        Vec::new(),
                        Vec::new(),
                        if idx.refresh() {
                            "full"
                        } else {
                            "bounded_stale"
                        },
                    )
                } else {
                    let (accepted, rejected) = idx.refresh_paths(&requested_paths);
                    (accepted, rejected, "targeted")
                };
                if !requested_paths.is_empty() && accepted_requested_paths.is_empty() {
                    return tool_success("pre_context", json!({
                        "status": "not_covered",
                        "reason": "outside_workspace",
                        "outside_workspace_files": outside_workspace_files,
                        "not_covered_files": outside_workspace_files,
                    }));
                }
                let requested_path = accepted_requested_paths.first().cloned();
                let preferred_files: HashSet<String> =
                    requested_path.iter().cloned().collect();
                let ts_files: Vec<String> = idx
                    .files()
                    .filter(|entry| matches!(entry.lang, language::Lang::TypeScript | language::Lang::Tsx))
                    .map(|entry| make_relative(&entry.path.to_string_lossy(), &root_str))
                    .collect();
                let py_files: Vec<String> = idx
                    .files()
                    .filter(|entry| entry.lang == language::Lang::Python)
                    .map(|entry| make_relative(&entry.path.to_string_lossy(), &root_str))
                    .collect();
                let rust_files: Vec<String> = idx
                    .files()
                    .filter(|entry| entry.lang == language::Lang::Rust)
                    .map(|entry| make_relative(&entry.path.to_string_lossy(), &root_str))
                    .collect();
                let go_files: Vec<String> = idx
                    .files()
                    .filter(|entry| entry.lang == language::Lang::Go)
                    .map(|entry| make_relative(&entry.path.to_string_lossy(), &root_str))
                    .collect();
                let java_files: Vec<String> = idx
                    .files()
                    .filter(|entry| entry.lang == language::Lang::Java)
                    .map(|entry| make_relative(&entry.path.to_string_lossy(), &root_str))
                    .collect();
                let structure_files = if requested_paths.is_empty() {
                    ts_files
                } else {
                    accepted_requested_paths
                        .iter()
                        .filter(|path| {
                            idx.files().any(|entry| {
                                matches!(entry.lang, language::Lang::TypeScript | language::Lang::Tsx)
                                    && make_relative(&entry.path.to_string_lossy(), &root_str)
                                        .eq_ignore_ascii_case(&make_relative(path, &root_str))
                            })
                        })
                        .cloned()
                        .collect()
                };
                let mut structure = if requested_paths.is_empty() {
                    ts_deep_layer::run_structure(
                        deep_layer,
                        &idx.root,
                        &structure_files,
                        &[symbol.to_string()],
                        &preferred_files.iter().cloned().collect::<Vec<_>>(),
                    )
                } else if structure_files.is_empty() {
                    ts_deep_layer::disabled_structure(&[symbol.to_string()])
                } else {
                    let mut scoped_results = Vec::new();
                    for scope in group_files_by_config_root(
                        &idx.root,
                        &structure_files,
                        &["tsconfig.json"],
                    ) {
                        let mut result = ts_deep_layer::run_structure(
                            deep_layer,
                            &scope.root,
                            &scope.helper_files,
                            &[symbol.to_string()],
                            &scope.helper_files,
                        );
                        result.snapshot_id = scoped_snapshot_id(
                            &idx.root,
                            &scope.root,
                            &scope.helper_files,
                            &["tsconfig.json"],
                            &result.snapshot_id,
                        );
                        let scope_name = config_scope_name(&idx.root, &scope.root);
                        retain_scoped_structure_paths(
                            idx,
                            &scope_name,
                            &mut result,
                            &mut outside_workspace_files,
                        );
                        scoped_results.push((scope_name, result));
                    }
                    aggregate_scoped_structure_results(scoped_results)
                };
                if requested_paths.is_empty() || structure_files.is_empty() {
                    let input_snapshot_id = scoped_snapshot_id(
                        &idx.root,
                        &idx.root,
                        &structure_files,
                        &["tsconfig.json"],
                        &structure.snapshot_id,
                    );
                    structure.snapshot_id = structure_snapshot_id(&input_snapshot_id, &structure);
                }
                let py_structure_files = if requested_paths.is_empty() {
                    py_files
                } else {
                    accepted_requested_paths
                        .iter()
                        .filter(|path| {
                            idx.files().any(|entry| {
                                entry.lang == language::Lang::Python
                                    && make_relative(&entry.path.to_string_lossy(), &root_str)
                                        .eq_ignore_ascii_case(&make_relative(path, &root_str))
                            })
                        })
                        .cloned()
                        .collect()
                };
                let (py_symbol_positions, _) = python_lsp_inputs(
                    idx,
                    &root_str,
                    &accepted_requested_paths,
                    &[symbol.to_string()],
                );
                let (_, py_import_tokens) = python_lsp_inputs(
                    idx,
                    &root_str,
                    &py_structure_files,
                    &[],
                );
                let mut py_structure = if py_structure_files.is_empty() {
                    py_deep_layer::disabled_structure(&[symbol.to_string()])
                } else if requested_paths.is_empty() {
                    py_deep_layer::run_structure(
                        py_layer,
                        &idx.root,
                        &py_structure_files,
                        &[symbol.to_string()],
                        &py_symbol_positions,
                        &py_import_tokens,
                    )
                } else {
                    let mut scoped_results = Vec::new();
                    for scope in group_files_by_config_root(
                        &idx.root,
                        &py_structure_files,
                        &["pyrightconfig.json", "pyproject.toml"],
                    ) {
                        let scope_root = scope.root.to_string_lossy().to_string();
                        let (symbol_positions, import_tokens) = python_lsp_inputs(
                            idx,
                            &scope_root,
                            &scope.helper_files,
                            &[symbol.to_string()],
                        );
                        let mut result = py_deep_layer::run_structure(
                            py_layer,
                            &scope.root,
                            &scope.helper_files,
                            &[symbol.to_string()],
                            &symbol_positions,
                            &import_tokens,
                        );
                        result.snapshot_id = scoped_snapshot_id(
                            &idx.root,
                            &scope.root,
                            &scope.helper_files,
                            &["pyrightconfig.json", "pyproject.toml"],
                            &result.snapshot_id,
                        );
                        let scope_name = config_scope_name(&idx.root, &scope.root);
                        retain_scoped_structure_paths(
                            idx,
                            &scope_name,
                            &mut result,
                            &mut outside_workspace_files,
                        );
                        scoped_results.push((scope_name, result));
                    }
                    aggregate_scoped_structure_results(scoped_results)
                };
                if requested_paths.is_empty() && !py_structure_files.is_empty() {
                    let input_snapshot_id = scoped_snapshot_id(
                        &idx.root,
                        &idx.root,
                        &py_structure_files,
                        &["pyrightconfig.json", "pyproject.toml"],
                        &py_structure.snapshot_id,
                    );
                    py_structure.snapshot_id = structure_snapshot_id(&input_snapshot_id, &py_structure);
                }
                let rust_structure_files = if requested_paths.is_empty() {
                    Vec::new()
                } else {
                    accepted_requested_paths.iter().filter(|path| {
                        idx.files().any(|entry| {
                            entry.lang == language::Lang::Rust
                                && make_relative(&entry.path.to_string_lossy(), &root_str)
                                    .eq_ignore_ascii_case(&make_relative(path, &root_str))
                        })
                    }).cloned().collect()
                };
                let (rust_symbol_positions, rust_import_tokens) = rust_lsp_inputs(
                    idx, &root_str, &rust_structure_files, &[symbol.to_string()],
                );
                let mut rust_structure = if rust_files.is_empty()
                    || (!requested_paths.is_empty() && rust_structure_files.is_empty())
                {
                    rust_deep_layer::disabled_structure(&[symbol.to_string()])
                } else if requested_paths.is_empty() {
                    rust_deep_layer::run_structure(
                        rust_layer, &idx.root, &rust_structure_files, &[symbol.to_string()],
                        &rust_symbol_positions, &rust_import_tokens,
                        true,
                    )
                } else {
                    let mut scoped_results = Vec::new();
                    for scope in group_files_by_config_root(
                        &idx.root,
                        &rust_structure_files,
                        &["Cargo.toml", "rust-project.json"],
                    ) {
                        let scope_root = scope.root.to_string_lossy().to_string();
                        let (symbol_positions, import_tokens) = rust_lsp_inputs(
                            idx,
                            &scope_root,
                            &scope.helper_files,
                            &[symbol.to_string()],
                        );
                        let mut result = rust_deep_layer::run_structure(
                            rust_layer,
                            &scope.root,
                            &scope.helper_files,
                            &[symbol.to_string()],
                            &symbol_positions,
                            &import_tokens,
                            false,
                        );
                        result.snapshot_id = scoped_snapshot_id(
                            &idx.root,
                            &scope.root,
                            &scope.helper_files,
                            &["Cargo.toml", "rust-project.json"],
                            &result.snapshot_id,
                        );
                        let scope_name = config_scope_name(&idx.root, &scope.root);
                        retain_scoped_structure_paths(
                            idx,
                            &scope_name,
                            &mut result,
                            &mut outside_workspace_files,
                        );
                        scoped_results.push((scope_name, result));
                    }
                    aggregate_scoped_structure_results(scoped_results)
                };
                if requested_paths.is_empty() && !rust_files.is_empty() {
                    let input_snapshot_id = scoped_snapshot_id(
                        &idx.root,
                        &idx.root,
                        &rust_files,
                        &["Cargo.toml", "rust-project.json"],
                        &rust_structure.snapshot_id,
                    );
                    rust_structure.snapshot_id = structure_snapshot_id(&input_snapshot_id, &rust_structure);
                }
                let go_structure_files = if requested_paths.is_empty() {
                    Vec::new()
                } else {
                    accepted_requested_paths
                        .iter()
                        .filter(|path| {
                            idx.files().any(|entry| {
                                entry.lang == language::Lang::Go
                                    && make_relative(&entry.path.to_string_lossy(), &root_str)
                                        .eq_ignore_ascii_case(&make_relative(path, &root_str))
                            })
                        })
                        .cloned()
                        .collect()
                };
                let (go_symbol_positions, go_import_tokens) =
                    go_lsp_inputs(idx, &root_str, &go_structure_files, &[symbol.to_string()]);
                let mut go_structure = if go_files.is_empty()
                    || (!requested_paths.is_empty() && go_structure_files.is_empty())
                {
                    go_deep_layer::disabled_structure(&[symbol.to_string()])
                } else {
                    go_deep_layer::run_structure(
                        go_layer,
                        &idx.root,
                        &go_structure_files,
                        &[symbol.to_string()],
                        &go_symbol_positions,
                        &go_import_tokens,
                        requested_paths.is_empty(),
                        "full",
                        true,
                        true,
                    )
                };
                if !go_files.is_empty() && (requested_paths.is_empty() || !go_structure_files.is_empty()) {
                    let snapshot_files = if requested_paths.is_empty() {
                        &go_files
                    } else {
                        &go_structure_files
                    };
                    let input_snapshot_id = scoped_snapshot_id(
                        &idx.root,
                        &idx.root,
                        snapshot_files,
                        &["go.mod", "go.work"],
                        &go_structure.snapshot_id,
                    );
                    go_structure.snapshot_id = structure_snapshot_id(&input_snapshot_id, &go_structure);
                }
                let java_structure_files = if requested_paths.is_empty() {
                    Vec::new()
                } else {
                    accepted_requested_paths.iter()
                        .filter(|path| language::Lang::from_path(Path::new(path)) == Some(language::Lang::Java))
                        .cloned().collect()
                };
                let (java_symbol_positions, java_import_tokens, java_dependency_tokens) = java_lsp_inputs(
                    idx, &root_str, &java_structure_files, &[symbol.to_string()],
                );
                let mut java_structure = if (requested_paths.is_empty() && java_files.is_empty())
                    || (!requested_paths.is_empty() && java_structure_files.is_empty())
                {
                    java_deep_layer::disabled_structure(&[symbol.to_string()])
                } else {
                    java_deep_layer::run_structure(
                        java_layer, &idx.root, &java_structure_files, &[symbol.to_string()],
                        &java_symbol_positions, &java_import_tokens, &java_dependency_tokens,
                        requested_paths.is_empty(),
                    )
                };
                if !java_files.is_empty() && (requested_paths.is_empty() || !java_structure_files.is_empty()) {
                    let snapshot_files = if requested_paths.is_empty() {
                        &java_files
                    } else {
                        &java_structure_files
                    };
                    let input_snapshot_id = scoped_snapshot_id(
                        &idx.root,
                        &idx.root,
                        snapshot_files,
                        &["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"],
                        &java_structure.snapshot_id,
                    );
                    java_structure.snapshot_id = structure_snapshot_id(&input_snapshot_id, &java_structure);
                }
                retain_workspace_structure_paths(idx, &mut structure, &mut outside_workspace_files);
                retain_workspace_structure_paths(idx, &mut py_structure, &mut outside_workspace_files);
                retain_workspace_structure_paths(idx, &mut rust_structure, &mut outside_workspace_files);
                retain_workspace_structure_paths(idx, &mut go_structure, &mut outside_workspace_files);
                retain_workspace_structure_paths(idx, &mut java_structure, &mut outside_workspace_files);
                outside_workspace_files.sort();
                outside_workspace_files.dedup();
                let ts_relations = if structure_files.is_empty() {
                    Default::default()
                } else {
                    structure.relations.get(symbol).cloned().unwrap_or_default()
                };
                let py_relations = py_structure.relations.get(symbol).cloned().unwrap_or_default();
                let rust_relations = rust_structure.relations.get(symbol).cloned().unwrap_or_default();
                let go_relations = go_structure
                    .relations
                    .get(symbol)
                    .cloned()
                    .unwrap_or_default();
                let java_relations = java_structure.relations.get(symbol).cloned().unwrap_or_default();
                let structure_verified = structure.status == "verified";
                let structure_available = !structure_files.is_empty() && structure.status != "tool_missing";
                let py_structure_verified = py_structure.status == "verified";
                let py_structure_available = matches!(py_structure.status, "verified" | "partially_verified");
                let rust_structure_verified = rust_structure.status == "verified";
                let rust_structure_available = matches!(rust_structure.status, "verified" | "partially_verified");
                let go_structure_verified = go_structure.status == "verified";
                let go_structure_available =
                    matches!(go_structure.status, "verified" | "partially_verified");
                let java_structure_verified = java_structure.status == "verified";
                let java_structure_available = matches!(java_structure.status, "verified" | "partially_verified");
                let use_ts_program = structure_available;
                let mut definitions = Vec::new();
                let mut references = Vec::new();
                let mut callees = Vec::new();
                let mut callers = Vec::new();
                let mut potential_parse_errors = HashSet::new();
                for entry in idx.files() {
                    let rel = make_relative(&entry.path.to_string_lossy(), &root_str);
                    if requested_path.as_ref().is_some_and(|requested| {
                        !rel.eq_ignore_ascii_case(requested)
                            && !(use_ts_program && ts_relations.related_files.contains(&rel))
                            && !(py_structure_available && py_relations.related_files.contains(&rel))
                            && !(rust_structure_available && rust_relations.related_files.contains(&rel))
                            && !(go_structure_available
                                && go_relations.related_files.contains(&rel))
                            && !(java_structure_available && java_relations.related_files.contains(&rel))
                    })
                    {
                        continue;
                    }
                    if entry.parse_error
                        && (requested_path.is_some() || entry.source.contains(symbol))
                    {
                        potential_parse_errors.insert(rel.clone());
                    }
                    if structure_available
                        && matches!(entry.lang, language::Lang::TypeScript | language::Lang::Tsx)
                    {
                        if !ts_relations.has_evidence()
                            && requested_path
                                .as_ref()
                                .is_some_and(|requested| rel.eq_ignore_ascii_case(requested))
                        {
                            definitions.extend(
                                symbols::extract_definitions(
                                    &entry.tree,
                                    &entry.source,
                                    &entry.path,
                                    entry.lang,
                                )
                                .into_iter()
                                .filter(|definition| definition.name == symbol),
                            );
                            references.extend(symbols::extract_references(
                                &entry.tree,
                                &entry.source,
                                &entry.path,
                                symbol,
                            ));
                            callees.extend(symbols::extract_callees(
                                &entry.tree,
                                &entry.source,
                                &entry.path,
                                symbol,
                                entry.lang,
                            ));
                            callers.extend(symbols::extract_callers(
                                &entry.tree,
                                &entry.source,
                                &entry.path,
                                symbol,
                                entry.lang,
                            ));
                            continue;
                        }
                        for target in ts_relations
                            .targets
                            .iter()
                            .filter(|target| target.file == rel)
                        {
                            definitions.extend(
                                symbols::extract_definitions(
                                    &entry.tree,
                                    &entry.source,
                                    &entry.path,
                                    entry.lang,
                                )
                                .into_iter()
                                .filter(|definition| definition.name == target.name),
                            );
                            callees.extend(symbols::extract_callees(
                                &entry.tree,
                                &entry.source,
                                &entry.path,
                                &target.name,
                                entry.lang,
                            ));
                        }
                        if let Some(names) = ts_relations.names_by_file.get(&rel) {
                            for name in names {
                                references.extend(symbols::extract_references(
                                    &entry.tree,
                                    &entry.source,
                                    &entry.path,
                                    name,
                                ));
                                callers.extend(symbols::extract_callers(
                                    &entry.tree,
                                    &entry.source,
                                    &entry.path,
                                    name,
                                    entry.lang,
                                ));
                            }
                        }
                        continue;
                    }
                    if entry.lang == language::Lang::Python {
                        if py_structure_available {
                            for target in py_relations.targets.iter().filter(|target| target.file == rel) {
                                definitions.extend(
                                    symbols::extract_definitions(
                                        &entry.tree,
                                        &entry.source,
                                        &entry.path,
                                        entry.lang,
                                    )
                                    .into_iter()
                                    .filter(|definition| {
                                        definition.name == target.name
                                            && definition.line == target.line
                                    }),
                                );
                            }
                            references.extend(py_relations.references.iter()
                                .filter(|reference| reference.file == rel)
                                .map(|reference| symbols::Reference {
                                    name: reference.name.clone(),
                                    qualified_name: None,
                                    file: entry.path.to_string_lossy().to_string(),
                                    line: reference.line,
                                }));
                            callers.extend(py_relations.callers.iter()
                                .filter(|caller| caller.file == rel)
                                .map(|caller| symbols::Callee {
                                    name: caller.name.clone(),
                                    qualified_name: None,
                                    file: entry.path.to_string_lossy().to_string(),
                                    line: caller.line,
                                    is_member: false,
                                    arg_count: 0,
                                }));
                            callees.extend(py_relations.callees.iter()
                                .filter(|callee| callee.file == rel)
                                .map(|callee| symbols::Callee {
                                    name: callee.name.clone(),
                                    qualified_name: None,
                                    file: entry.path.to_string_lossy().to_string(),
                                    line: callee.line,
                                    is_member: false,
                                    arg_count: 0,
                                }));
                        }
                        continue;
                    }
                    if entry.lang == language::Lang::Rust {
                        if rust_structure_available {
                            for target in rust_relations.targets.iter().filter(|target| target.file == rel) {
                                definitions.extend(
                                    symbols::extract_definitions(&entry.tree, &entry.source, &entry.path, entry.lang)
                                        .into_iter()
                                        .filter(|definition| definition.name == target.name && definition.line == target.line),
                                );
                            }
                            references.extend(rust_relations.references.iter()
                                .filter(|reference| reference.file == rel)
                                .map(|reference| symbols::Reference {
                                    name: reference.name.clone(), qualified_name: None,
                                    file: entry.path.to_string_lossy().to_string(), line: reference.line,
                                }));
                            callers.extend(rust_relations.callers.iter()
                                .filter(|caller| caller.file == rel)
                                .map(|caller| symbols::Callee {
                                    name: caller.name.clone(), qualified_name: None,
                                    file: entry.path.to_string_lossy().to_string(), line: caller.line,
                                    is_member: false, arg_count: 0,
                                }));
                            callees.extend(rust_relations.callees.iter()
                                .filter(|callee| callee.file == rel)
                                .map(|callee| symbols::Callee {
                                    name: callee.name.clone(), qualified_name: None,
                                    file: entry.path.to_string_lossy().to_string(), line: callee.line,
                                    is_member: false, arg_count: 0,
                                }));
                        }
                        continue;
                    }
                    if entry.lang == language::Lang::Go {
                        if go_structure_available {
                            for target in go_relations
                                .targets
                                .iter()
                                .filter(|target| target.file == rel)
                            {
                                definitions.extend(
                                    symbols::extract_definitions(
                                        &entry.tree,
                                        &entry.source,
                                        &entry.path,
                                        entry.lang,
                                    )
                                    .into_iter()
                                    .filter(|definition| {
                                        definition.name == target.name
                                            && definition.line == target.line
                                    }),
                                );
                            }
                            references.extend(
                                go_relations
                                    .references
                                    .iter()
                                    .filter(|reference| reference.file == rel)
                                    .map(|reference| symbols::Reference {
                                        name: reference.name.clone(),
                                        qualified_name: None,
                                        file: entry.path.to_string_lossy().to_string(),
                                        line: reference.line,
                                    }),
                            );
                            callers.extend(
                                go_relations
                                    .callers
                                    .iter()
                                    .filter(|caller| caller.file == rel)
                                    .map(|caller| symbols::Callee {
                                        name: caller.name.clone(),
                                        qualified_name: None,
                                        file: entry.path.to_string_lossy().to_string(),
                                        line: caller.line,
                                        is_member: false,
                                        arg_count: 0,
                                    }),
                            );
                            callees.extend(
                                go_relations
                                    .callees
                                    .iter()
                                    .filter(|callee| callee.file == rel)
                                    .map(|callee| symbols::Callee {
                                        name: callee.name.clone(),
                                        qualified_name: None,
                                        file: entry.path.to_string_lossy().to_string(),
                                        line: callee.line,
                                        is_member: false,
                                        arg_count: 0,
                                    }),
                            );
                        }
                        continue;
                    }
                    if entry.lang == language::Lang::Java {
                        if java_structure_available {
                            for target in java_relations.targets.iter().filter(|target| target.file == rel) {
                                definitions.extend(
                                    symbols::extract_definitions(&entry.tree, &entry.source, &entry.path, entry.lang)
                                        .into_iter()
                                        .filter(|definition| definition.name == target.name && definition.line == target.line),
                                );
                            }
                            references.extend(java_relations.references.iter()
                                .filter(|reference| reference.file == rel)
                                .map(|reference| symbols::Reference {
                                    name: reference.name.clone(), qualified_name: None,
                                    file: entry.path.to_string_lossy().to_string(), line: reference.line,
                                }));
                            callers.extend(java_relations.callers.iter()
                                .filter(|caller| caller.file == rel)
                                .map(|caller| symbols::Callee {
                                    name: caller.name.clone(), qualified_name: None,
                                    file: entry.path.to_string_lossy().to_string(), line: caller.line,
                                    is_member: false, arg_count: 0,
                                }));
                            callees.extend(java_relations.callees.iter()
                                .filter(|callee| callee.file == rel)
                                .map(|callee| symbols::Callee {
                                    name: callee.name.clone(), qualified_name: None,
                                    file: entry.path.to_string_lossy().to_string(), line: callee.line,
                                    is_member: false, arg_count: 0,
                                }));
                        }
                        continue;
                    }
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
                definitions.sort_by(|left, right| {
                    left.file
                        .cmp(&right.file)
                        .then_with(|| left.line.cmp(&right.line))
                        .then_with(|| left.name.cmp(&right.name))
                });
                references.sort_by(|left, right| {
                    left.file
                        .cmp(&right.file)
                        .then_with(|| left.line.cmp(&right.line))
                        .then_with(|| left.name.cmp(&right.name))
                        .then_with(|| left.qualified_name.cmp(&right.qualified_name))
                });
                callees.sort_by(|left, right| {
                    left.file
                        .cmp(&right.file)
                        .then_with(|| left.line.cmp(&right.line))
                        .then_with(|| left.name.cmp(&right.name))
                        .then_with(|| left.qualified_name.cmp(&right.qualified_name))
                });
                callers.sort_by(|left, right| {
                    left.file
                        .cmp(&right.file)
                        .then_with(|| left.line.cmp(&right.line))
                        .then_with(|| left.name.cmp(&right.name))
                        .then_with(|| left.qualified_name.cmp(&right.qualified_name))
                });
                let definition = (definitions.len() == 1).then(|| {
                    let d = &definitions[0];
                    json!({
                    "name": d.name,
                    "file": d.file,
                    "line": d.line,
                    "kind": format!("{:?}", d.kind),
                    "signature": d.signature,
                    })
                });
                let definition_candidates: Vec<Value> = definitions.iter().map(|d| json!({
                    "name": d.name,
                    "file": d.file,
                    "line": d.line,
                    "kind": format!("{:?}", d.kind),
                    "signature": d.signature,
                })).collect();
                let unresolved_module_specifiers =
                    ts_relations.unresolved_module_specifiers.iter()
                        .chain(&py_relations.unresolved_module_specifiers)
                        .chain(&rust_relations.unresolved_module_specifiers)
                        .chain(&java_relations.unresolved_module_specifiers)
                        .cloned()
                        .collect::<Vec<_>>();
                let external_module_specifiers = ts_relations
                    .external_module_specifiers
                    .iter()
                    .chain(&py_relations.external_module_specifiers)
                    .chain(&rust_relations.external_module_specifiers)
                    .chain(&java_relations.external_module_specifiers)
                    .cloned()
                    .collect::<Vec<_>>();
                let refs_json: Vec<Value> = references.iter().map(|r| json!({
                    "name": r.name,
                    "qualified_name": r.qualified_name,
                    "is_member": r.qualified_name.is_some(),
                    "file": r.file,
                    "line": r.line,
                })).collect();
                let callees_json: Vec<Value> = callees.iter().map(|c| json!({
                    "name": c.name,
                    "qualified_name": c.qualified_name,
                    "is_member": c.is_member,
                    "file": c.file,
                    "line": c.line,
                })).collect();
                let callers_json: Vec<Value> = callers.iter().map(|c| json!({
                    "name": c.name,
                    "qualified_name": c.qualified_name,
                    "is_member": c.is_member,
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
                if definitions.len() > 1 {
                    missing_evidence.push("ambiguous_definitions");
                }
                if !unresolved_module_specifiers.is_empty() {
                    missing_evidence.push("module_resolution");
                }
                if definitions.is_empty() && !external_module_specifiers.is_empty() {
                    missing_evidence.push("external_module_resolution");
                }
                if !ts_relations.blocked_module_specifiers.is_empty() {
                    missing_evidence.push("blocked_module_path");
                }
                if !ts_relations.dynamic_import_files.is_empty() {
                    missing_evidence.push("dynamic_imports");
                }
                if ts_relations.graph_cycle {
                    missing_evidence.push("module_graph_cycle");
                }
                if ts_relations.graph_truncated {
                    missing_evidence.push("module_graph_truncated");
                }
                let mut parse_errors: Vec<String> = potential_parse_errors.into_iter().collect();
                parse_errors.sort();
                if !parse_errors.is_empty() {
                    missing_evidence.push("parse_errors");
                }
                if index_consistency == "bounded_stale" {
                    missing_evidence.push("index_snapshot_staleness");
                }
                if !outside_workspace_files.is_empty() {
                    missing_evidence.push("outside_workspace");
                }
                if !structure_files.is_empty() && !structure_verified {
                    missing_evidence.push("typescript_program");
                }
                if !py_structure_verified && !py_structure_files.is_empty() {
                    missing_evidence.push("pyright_program");
                }
                if !rust_structure_verified && !rust_structure_files.is_empty() {
                    missing_evidence.push("rust_analyzer_program");
                }
                if !go_structure_verified
                    && (!go_structure_files.is_empty()
                        || (requested_paths.is_empty() && !go_files.is_empty()))
                {
                    missing_evidence.push("gopls_program");
                }
                if !java_structure_verified && !java_structure_files.is_empty() {
                    missing_evidence.push("jdtls_program");
                }
                let confidence = if definitions.is_empty() {
                    "low"
                } else if !outside_workspace_files.is_empty() {
                    "medium"
                } else if definitions.len() > 1 {
                    "low"
                } else if !ts_relations.blocked_module_specifiers.is_empty()
                    || ts_relations.graph_truncated
                {
                    "low"
                } else if !parse_errors.is_empty()
                    || !unresolved_module_specifiers.is_empty()
                    || (definitions.is_empty() && !external_module_specifiers.is_empty())
                    || !ts_relations.dynamic_import_files.is_empty()
                    || ts_relations.graph_cycle
                    || index_consistency == "bounded_stale"
                    || (!structure_files.is_empty() && !structure_verified)
                    || (!py_structure_files.is_empty() && !py_structure_verified)
                    || (!rust_structure_files.is_empty() && !rust_structure_verified)
                    || ((!go_structure_files.is_empty()
                        || (requested_paths.is_empty() && !go_files.is_empty()))
                        && !go_structure_verified)
                    || (!java_structure_files.is_empty() && !java_structure_verified)
                {
                    "medium"
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
                        "qualified_name": c.qualified_name,
                        "is_member": c.is_member,
                        "file": make_relative(&c.file, &root_str),
                        "line": c.line,
                    }))
                    .collect();
                let mut result = json!({
                    "definition": definition,
                    "definition_candidates": definition_candidates,
                    "references": refs_json,
                    "callees": callees_json,
                    "callers": callers_json,
                    "signature": (definitions.len() == 1).then(|| definitions[0].signature.as_str()).unwrap_or(""),
                    "parse_errors": parse_errors,
                    "unresolved_module_specifiers": unresolved_module_specifiers,
                    "unresolved_relative_specifiers": ts_relations.unresolved_relative_specifiers,
                    "external_module_specifiers": external_module_specifiers,
                    "blocked_module_specifiers": ts_relations.blocked_module_specifiers,
                    "dynamic_import_files": ts_relations.dynamic_import_files,
                    "module_graph_cycle": ts_relations.graph_cycle,
                    "module_graph_truncated": ts_relations.graph_truncated,
                    "index_consistency": index_consistency,
                    "max_staleness_ms": index::MAX_STALENESS_MS,
                    "semantic_engine": "language_semantic_programs",
                    "semantic_engine_status": structure.status,
                    "semantic_engine_reason": structure.reason,
                    "semantic_snapshot_id": structure.snapshot_id,
                    "program_build_count": structure.program_build_count,
                    "program_rebuilt": structure.program_rebuilt,
                    "semantic_elapsed_ms": structure.elapsed_ms,
                    "python_semantic_engine_status": py_structure.status,
                    "python_semantic_engine_reason": py_structure.reason,
                    "python_semantic_snapshot_id": py_structure.snapshot_id,
                    "python_program_build_count": py_structure.program_build_count,
                    "python_program_rebuilt": py_structure.program_rebuilt,
                    "python_semantic_elapsed_ms": py_structure.elapsed_ms,
                    "rust_semantic_engine_status": rust_structure.status,
                    "rust_semantic_engine_reason": rust_structure.reason,
                    "rust_semantic_snapshot_id": rust_structure.snapshot_id,
                    "rust_program_build_count": rust_structure.program_build_count,
                    "rust_program_rebuilt": rust_structure.program_rebuilt,
                    "rust_semantic_elapsed_ms": rust_structure.elapsed_ms,
                    "java_semantic_engine_status": java_structure.status,
                    "java_semantic_engine_reason": java_structure.reason,
                    "java_semantic_snapshot_id": java_structure.snapshot_id,
                    "java_program_build_count": java_structure.program_build_count,
                    "java_program_rebuilt": java_structure.program_rebuilt,
                    "java_semantic_elapsed_ms": java_structure.elapsed_ms,
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
                result["go_semantic_engine_status"] = json!(go_structure.status);
                result["go_semantic_engine_reason"] = json!(go_structure.reason);
                result["go_semantic_snapshot_id"] = json!(go_structure.snapshot_id);
                result["go_program_build_count"] = json!(go_structure.program_build_count);
                result["go_program_rebuilt"] = json!(go_structure.program_rebuilt);
                result["go_semantic_elapsed_ms"] = json!(go_structure.elapsed_ms);
                result["outside_workspace_files"] = json!(outside_workspace_files);
                result["not_covered_files"] = json!(outside_workspace_files);
                if java_relations.targets.len() > 1 {
                    result["status"] = json!("ambiguous");
                }
                tool_success("pre_context", result)
            } else {
                tool_error("index not initialized — send initialize with rootUri first")
            }
        }
        "pre_impact" => {
            handle_pre_impact(arguments, index, deep_layer, py_layer, rust_layer, go_layer, java_layer)
        }
        "pre_plan" => {
            handle_pre_plan(arguments, index, deep_layer, py_layer, rust_layer, go_layer, java_layer)
        }
        "pre_verify" => {
            handle_pre_verify(arguments, index, deep_layer, py_layer, rust_layer, go_layer, java_layer, sql_layer, shell_layer, csharp_layer, php_layer, ruby_layer, kotlin_layer, dart_layer, swift_layer, cpp_layer)
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

const MAX_IMPACT_SEED_SYMBOLS: usize = 100;
const MAX_AFFECTED_REFERENCES: usize = 200;
const MAX_IMPACT_MINIMAL_READS: usize = 20;
const MAX_JAVA_PLAN_CLOSURE_ROUNDS: usize = 16;

fn truncate_impact_minimal_reads(reads: &mut Vec<Value>) -> bool {
    let truncated = reads.len() > MAX_IMPACT_MINIMAL_READS;
    reads.truncate(MAX_IMPACT_MINIMAL_READS);
    truncated
}

fn handle_pre_impact(
    arguments: &Value,
    index: &mut Option<Index>,
    deep_layer: &mut Option<ts_deep_layer::DeepLayer>,
    py_layer: &mut Option<py_deep_layer::PyDeepLayer>,
    rust_layer: &mut Option<rust_deep_layer::RustDeepLayer>,
    go_layer: &mut Option<go_deep_layer::GoDeepLayer>,
    java_layer: &mut Option<java_deep_layer::JavaDeepLayer>,
) -> Value {
    let changes = match arguments.get("changes").and_then(|c| c.as_array()) {
        Some(arr) => arr,
        None => return tool_error("changes array is required"),
    };
    if changes.is_empty() {
        return tool_error("changes array must not be empty");
    }
    let change_paths: Vec<String> = changes
        .iter()
        .filter_map(|change| change.get("path").and_then(Value::as_str))
        .map(str::to_string)
        .collect();
    if let Some(result) = reject_non_structural_paths("pre_impact", &change_paths) {
        return result;
    }
    let idx = match index.as_mut() {
        Some(i) => i,
        None => return tool_error("index not initialized — send initialize with rootUri first"),
    };
    let (accepted_change_paths, mut outside_workspace_files) = idx.refresh_paths(&change_paths);
    if !change_paths.is_empty() && accepted_change_paths.is_empty() {
        return tool_success("pre_impact", json!({
            "status": "not_covered",
            "reason": "outside_workspace",
            "outside_workspace_files": outside_workspace_files,
            "not_covered_files": outside_workspace_files,
        }));
    }
    let root_str = idx.root.to_string_lossy().to_string();
    let outside_workspace_path_set: HashSet<&str> = outside_workspace_files
        .iter()
        .map(String::as_str)
        .collect();
    let mut seed_symbols: Vec<String> = Vec::new();
    let mut seen_seed_symbols = HashSet::new();
    let mut ts_seed_symbols = HashSet::new();
    let mut py_seed_symbols = HashSet::new();
    let mut rust_seed_symbols = HashSet::new();
    let mut go_seed_symbols = HashSet::new();
    let mut java_seed_symbols = HashSet::new();
    let mut non_ts_seed_symbols = HashSet::new();
    let mut seed_symbols_truncated = false;
    let changed_files: HashSet<String> = accepted_change_paths.iter().cloned().collect();

    for change in changes {
        let change_path = change
            .get("path")
            .and_then(|p| p.as_str())
            .map(|path| make_relative(path, &root_str));
        if change
            .get("path")
            .and_then(Value::as_str)
            .is_some_and(|path| outside_workspace_path_set.contains(path))
        {
            continue;
        }
        if let Some(syms) = change.get("symbols").and_then(|s| s.as_array()) {
            for s in syms {
                if let Some(name) = s.as_str() {
                    let seed_language = change_path.as_ref().and_then(|path| {
                        idx.files()
                            .find(|entry| make_relative(&entry.path.to_string_lossy(), &root_str) == *path)
                            .map(|entry| entry.lang)
                            .or_else(|| language::Lang::from_path(Path::new(path)))
                    });
                    match seed_language {
                        Some(language::Lang::TypeScript | language::Lang::Tsx) => {
                            ts_seed_symbols.insert(name.to_string());
                        }
                        Some(language::Lang::Python) => {
                            py_seed_symbols.insert(name.to_string());
                        }
                        Some(language::Lang::Rust) => {
                            rust_seed_symbols.insert(name.to_string());
                        }
                        Some(language::Lang::Go) => {
                            go_seed_symbols.insert(name.to_string());
                        }
                        Some(language::Lang::Java) => {
                            java_seed_symbols.insert(name.to_string());
                        }
                        _ => {
                            non_ts_seed_symbols.insert(name.to_string());
                        }
                    }
                    if seen_seed_symbols.insert(name.to_string()) {
                        if seed_symbols.len() < MAX_IMPACT_SEED_SYMBOLS {
                            seed_symbols.push(name.to_string());
                        } else {
                            seed_symbols_truncated = true;
                        }
                    }
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
                    if matches!(entry.lang, language::Lang::TypeScript | language::Lang::Tsx) {
                        ts_seed_symbols.insert(d.name.clone());
                    } else if entry.lang == language::Lang::Python {
                        py_seed_symbols.insert(d.name.clone());
                    } else if entry.lang == language::Lang::Rust {
                        rust_seed_symbols.insert(d.name.clone());
                    } else if entry.lang == language::Lang::Go {
                        go_seed_symbols.insert(d.name.clone());
                    } else if entry.lang == language::Lang::Java {
                        java_seed_symbols.insert(d.name.clone());
                    } else {
                        non_ts_seed_symbols.insert(d.name.clone());
                    }
                    if seen_seed_symbols.insert(d.name.clone()) {
                        if seed_symbols.len() < MAX_IMPACT_SEED_SYMBOLS {
                            seed_symbols.push(d.name);
                        } else {
                            seed_symbols_truncated = true;
                        }
                    }
                }
            }
        }
    }

    let max_depth: usize = 2;
    let mut visited: HashSet<String> = HashSet::new();
    let mut queue: VecDeque<(String, usize)> = VecDeque::new();
    let mut affected_functions: Vec<Value> = Vec::new();
    let mut affected_references: Vec<Value> = Vec::new();
    let mut affected_files: HashSet<String> = HashSet::new();
    let mut seen_references: HashSet<(String, String, usize, Option<String>)> = HashSet::new();
    let mut has_cross_file_reference = false;
    let mut affected_references_truncated = false;

    let ts_files: Vec<String> = idx
        .files()
        .filter(|entry| matches!(entry.lang, language::Lang::TypeScript | language::Lang::Tsx))
        .map(|entry| make_relative(&entry.path.to_string_lossy(), &root_str))
        .collect();
    let structure_files = if change_paths.is_empty() {
        ts_files
    } else {
        accepted_change_paths
            .iter()
            .filter(|path| {
                idx.files().any(|entry| {
                    matches!(entry.lang, language::Lang::TypeScript | language::Lang::Tsx)
                        && make_relative(&entry.path.to_string_lossy(), &root_str)
                            .eq_ignore_ascii_case(&make_relative(path, &root_str))
                })
            })
            .cloned()
            .collect()
    };
    let ts_symbols_requested: Vec<String> = ts_seed_symbols.iter().cloned().collect();
    let mut structure = if structure_files.is_empty() {
        ts_deep_layer::disabled_structure(&ts_symbols_requested)
    } else {
        let mut scoped_results = Vec::new();
        for scope in group_files_by_config_root(&idx.root, &structure_files, &["tsconfig.json"]) {
            let mut result = ts_deep_layer::run_structure(
                deep_layer,
                &scope.root,
                &scope.helper_files,
                &ts_symbols_requested,
                &scope.helper_files,
            );
            result.snapshot_id = scoped_snapshot_id(
                &idx.root,
                &scope.root,
                &scope.helper_files,
                &["tsconfig.json"],
                &result.snapshot_id,
            );
            let scope_name = config_scope_name(&idx.root, &scope.root);
            retain_scoped_structure_paths(
                idx,
                &scope_name,
                &mut result,
                &mut outside_workspace_files,
            );
            scoped_results.push((scope_name, result));
        }
        aggregate_scoped_structure_results(scoped_results)
    };
    if structure_files.is_empty() {
        let input_snapshot_id = scoped_snapshot_id(
            &idx.root,
            &idx.root,
            &structure_files,
            &["tsconfig.json"],
            &structure.snapshot_id,
        );
        structure.snapshot_id = structure_snapshot_id(&input_snapshot_id, &structure);
    }
    let py_symbols_requested: Vec<String> = py_seed_symbols.iter().cloned().collect();
    let py_change_files: Vec<String> = accepted_change_paths
        .iter()
        .filter(|path| {
            idx.files().any(|entry| {
                entry.lang == language::Lang::Python
                    && make_relative(&entry.path.to_string_lossy(), &root_str)
                        .eq_ignore_ascii_case(&make_relative(path, &root_str))
            })
        })
        .cloned()
        .collect();
    let mut py_structure = if py_change_files.is_empty() {
        py_deep_layer::disabled_structure(&py_symbols_requested)
    } else {
        let mut scoped_results = Vec::new();
        for scope in group_files_by_config_root(
            &idx.root,
            &py_change_files,
            &["pyrightconfig.json", "pyproject.toml"],
        ) {
            let scope_root = scope.root.to_string_lossy().to_string();
            let (symbol_positions, import_tokens) =
                python_lsp_inputs(idx, &scope_root, &scope.helper_files, &py_symbols_requested);
            let mut result = py_deep_layer::run_structure(
                py_layer,
                &scope.root,
                &scope.helper_files,
                &py_symbols_requested,
                &symbol_positions,
                &import_tokens,
            );
            result.snapshot_id = scoped_snapshot_id(
                &idx.root,
                &scope.root,
                &scope.helper_files,
                &["pyrightconfig.json", "pyproject.toml"],
                &result.snapshot_id,
            );
            let scope_name = config_scope_name(&idx.root, &scope.root);
            retain_scoped_structure_paths(
                idx,
                &scope_name,
                &mut result,
                &mut outside_workspace_files,
            );
            scoped_results.push((scope_name, result));
        }
        aggregate_scoped_structure_results(scoped_results)
    };
    let rust_symbols_requested: Vec<String> = rust_seed_symbols.iter().cloned().collect();
    let rust_change_files: Vec<String> = accepted_change_paths
        .iter()
        .filter(|path| language::Lang::from_path(Path::new(path)) == Some(language::Lang::Rust))
        .cloned()
        .collect();
    let mut rust_structure = if rust_change_files.is_empty() {
        rust_deep_layer::disabled_structure(&rust_symbols_requested)
    } else {
        let mut scoped_results = Vec::new();
        for scope in group_files_by_config_root(
            &idx.root,
            &rust_change_files,
            &["Cargo.toml", "rust-project.json"],
        ) {
            let scope_root = scope.root.to_string_lossy().to_string();
            let (symbol_positions, import_tokens) =
                rust_lsp_inputs(idx, &scope_root, &scope.helper_files, &rust_symbols_requested);
            let mut result = rust_deep_layer::run_structure(
                rust_layer,
                &scope.root,
                &scope.helper_files,
                &rust_symbols_requested,
                &symbol_positions,
                &import_tokens,
                false,
            );
            result.snapshot_id = scoped_snapshot_id(
                &idx.root,
                &scope.root,
                &scope.helper_files,
                &["Cargo.toml", "rust-project.json"],
                &result.snapshot_id,
            );
            let scope_name = config_scope_name(&idx.root, &scope.root);
            retain_scoped_structure_paths(
                idx,
                &scope_name,
                &mut result,
                &mut outside_workspace_files,
            );
            scoped_results.push((scope_name, result));
        }
        aggregate_scoped_structure_results(scoped_results)
    };
    let go_symbols_requested: Vec<String> = go_seed_symbols.iter().cloned().collect();
    let go_change_files: Vec<String> = accepted_change_paths
        .iter()
        .filter(|path| language::Lang::from_path(Path::new(path)) == Some(language::Lang::Go))
        .cloned()
        .collect();
    let (go_symbol_positions, go_import_tokens) =
        go_lsp_inputs(idx, &root_str, &go_change_files, &go_symbols_requested);
    let mut go_structure = if go_change_files.is_empty() {
        go_deep_layer::disabled_structure(&go_symbols_requested)
    } else {
        go_deep_layer::run_structure(
            go_layer,
            &idx.root,
            &go_change_files,
            &go_symbols_requested,
            &go_symbol_positions,
            &go_import_tokens,
            false,
            "full",
            true,
            false,
        )
    };
    if !go_change_files.is_empty() {
        let input_snapshot_id = scoped_snapshot_id(
            &idx.root,
            &idx.root,
            &go_change_files,
            &["go.mod", "go.work"],
            &go_structure.snapshot_id,
        );
        go_structure.snapshot_id = structure_snapshot_id(&input_snapshot_id, &go_structure);
    }
    let java_symbols_requested: Vec<String> = java_seed_symbols.iter().cloned().collect();
    let java_change_files: Vec<String> = accepted_change_paths
        .iter()
        .filter(|path| language::Lang::from_path(Path::new(path)) == Some(language::Lang::Java))
        .cloned()
        .collect();
    let (java_symbol_positions, java_import_tokens, java_dependency_tokens) =
        java_lsp_inputs(idx, &root_str, &java_change_files, &java_symbols_requested);
    let mut java_structure = if java_change_files.is_empty() {
        java_deep_layer::disabled_structure(&java_symbols_requested)
    } else {
        java_deep_layer::run_structure(
            java_layer, &idx.root, &java_change_files, &java_symbols_requested,
            &java_symbol_positions, &java_import_tokens, &java_dependency_tokens, false,
        )
    };
    if !java_change_files.is_empty() {
        let input_snapshot_id = scoped_snapshot_id(
            &idx.root,
            &idx.root,
            &java_change_files,
            &["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"],
            &java_structure.snapshot_id,
        );
        java_structure.snapshot_id = structure_snapshot_id(&input_snapshot_id, &java_structure);
    }
    retain_workspace_structure_paths(idx, &mut structure, &mut outside_workspace_files);
    retain_workspace_structure_paths(idx, &mut py_structure, &mut outside_workspace_files);
    retain_workspace_structure_paths(idx, &mut rust_structure, &mut outside_workspace_files);
    retain_workspace_structure_paths(idx, &mut go_structure, &mut outside_workspace_files);
    retain_workspace_structure_paths(idx, &mut java_structure, &mut outside_workspace_files);
    outside_workspace_files.sort();
    outside_workspace_files.dedup();
    let ts_relations = structure.relations.clone();
    let py_relations = py_structure.relations.clone();
    let rust_relations = rust_structure.relations.clone();
    let go_relations = go_structure.relations.clone();
    let java_relations = java_structure.relations.clone();
    let structure_verified = structure.status == "verified";
    let structure_available = structure.status != "tool_missing";
    let py_structure_verified = py_structure.status == "verified";
    let py_structure_available = matches!(py_structure.status, "verified" | "partially_verified");
    let rust_structure_verified = rust_structure.status == "verified";
    let rust_structure_available = matches!(rust_structure.status, "verified" | "partially_verified");
    let go_structure_verified = go_structure.status == "verified";
    let go_structure_available = matches!(go_structure.status, "verified" | "partially_verified");
    let java_structure_verified = java_structure.status == "verified";
    let java_structure_available = matches!(java_structure.status, "verified" | "partially_verified");
    let ts_symbols: HashSet<String> = ts_relations
        .iter()
        .filter_map(|(symbol, relations)| {
            (relations.has_evidence()
                || (structure_available && ts_seed_symbols.contains(symbol)))
                .then_some(symbol.clone())
        })
        .collect();
    let py_symbols: HashSet<String> = py_relations
        .iter()
        .filter_map(|(symbol, relations)| {
            (relations.has_evidence()
                || (py_structure_available && py_seed_symbols.contains(symbol)))
                .then_some(symbol.clone())
        })
        .collect();
    let rust_symbols: HashSet<String> = rust_relations.iter().filter_map(|(symbol, relations)| {
        (relations.has_evidence() || (rust_structure_available && rust_seed_symbols.contains(symbol)))
            .then_some(symbol.clone())
    }).collect();
    let go_symbols: HashSet<String> = go_relations
        .iter()
        .filter_map(|(symbol, relations)| {
            (relations.has_evidence()
                || (go_structure_available && go_seed_symbols.contains(symbol)))
            .then_some(symbol.clone())
        })
        .collect();
    let java_symbols: HashSet<String> = java_relations.iter().filter_map(|(symbol, relations)| {
        (relations.has_evidence() || (java_structure_available && java_seed_symbols.contains(symbol)))
            .then_some(symbol.clone())
    }).collect();

    for sym in &seed_symbols {
        visited.insert(sym.clone());
        if (!ts_symbols.contains(sym)
            && !py_symbols.contains(sym)
            && !rust_symbols.contains(sym)
            && !go_symbols.contains(sym)
            && !java_symbols.contains(sym))
            || non_ts_seed_symbols.contains(sym)
        {
            queue.push_back((sym.clone(), 0));
        }
    }

    let mut file_entries: Vec<(&PathBuf, &tree_sitter::Tree, &str, crate::language::Lang)> = idx
        .files()
        .map(|e| (&e.path, &e.tree, e.source.as_str(), e.lang))
        .collect();
    file_entries.sort_by(|left, right| left.0.cmp(right.0));

    let mut relation_symbols: Vec<(&String, &ts_deep_layer::SymbolRelations)> = ts_relations
        .iter()
        .filter(|(symbol, _)| ts_symbols.contains(*symbol))
        .collect();
    relation_symbols.sort_by(|left, right| left.0.cmp(right.0));
    for (symbol, relations) in relation_symbols {
        if relations.targets.len() != 1 {
            continue;
        }
        affected_files.extend(relations.related_files.iter().cloned());
        let mut relation_files: Vec<&String> = relations.names_by_file.keys().collect();
        relation_files.sort();
        for file in relation_files {
            let names = &relations.names_by_file[file];
            let Some((path, tree, source, lang)) = file_entries.iter().find(|(path, _, _, _)| {
                make_relative(&path.to_string_lossy(), &root_str) == *file
            }) else {
                continue;
            };
            let mut names: Vec<&String> = names.iter().collect();
            names.sort();
            for name in names {
                for reference in symbols::extract_references(tree, source, path, name) {
                    let rel_file = make_relative(&reference.file, &root_str);
                    let identity = (
                        symbol.clone(),
                        rel_file.clone(),
                        reference.line,
                        reference.qualified_name.clone(),
                    );
                    if !changed_files.contains(&rel_file) {
                        has_cross_file_reference = true;
                    }
                    if seen_references.insert(identity) {
                        if affected_references.len() < MAX_AFFECTED_REFERENCES {
                            affected_references.push(json!({
                                "name": reference.name,
                                "qualified_name": reference.qualified_name,
                                "is_member": reference.qualified_name.is_some(),
                                "file": rel_file,
                                "line": reference.line,
                                "depth": 0,
                            }));
                        } else {
                            affected_references_truncated = true;
                        }
                    }
                }
                for caller in symbols::extract_callers(tree, source, path, name, *lang) {
                    let rel_file = make_relative(&caller.file, &root_str);
                    affected_files.insert(rel_file.clone());
                    if visited.insert(format!("{rel_file}:{}", caller.name)) {
                        affected_functions.push(json!({
                            "name": caller.name,
                            "qualified_name": caller.qualified_name,
                            "is_member": caller.is_member,
                            "file": rel_file,
                            "line": caller.line,
                            "depth": 1,
                        }));
                    }
                }
            }
        }
    }
    let mut semantic_relation_symbols: Vec<_> = py_relations
        .iter()
        .filter(|(symbol, _)| py_symbols.contains(*symbol))
        .chain(rust_relations.iter().filter(|(symbol, _)| rust_symbols.contains(*symbol)))
        .chain(
            go_relations
                .iter()
                .filter(|(symbol, _)| go_symbols.contains(*symbol)),
        )
        .chain(java_relations.iter().filter(|(symbol, _)| java_symbols.contains(*symbol)))
        .collect();
    semantic_relation_symbols.sort_by(|left, right| left.0.cmp(right.0));
    for (symbol, relations) in semantic_relation_symbols {
        if relations.targets.len() != 1 {
            continue;
        }
        affected_files.extend(relations.related_files.iter().cloned());
        for reference in &relations.references {
            let identity = (symbol.clone(), reference.file.clone(), reference.line, None);
            if !changed_files.contains(&reference.file) {
                has_cross_file_reference = true;
            }
            if seen_references.insert(identity) {
                if affected_references.len() < MAX_AFFECTED_REFERENCES {
                    affected_references.push(json!({
                        "name": reference.name,
                        "qualified_name": null,
                        "is_member": false,
                        "file": reference.file,
                        "line": reference.line,
                        "depth": 0,
                    }));
                } else {
                    affected_references_truncated = true;
                }
            }
        }
        for caller in &relations.callers {
            affected_files.insert(caller.file.clone());
            if visited.insert(format!("{}:{}:{}", caller.file, caller.line, caller.name)) {
                affected_functions.push(json!({
                    "name": caller.name,
                    "qualified_name": null,
                    "is_member": false,
                    "file": caller.file,
                    "line": caller.line,
                    "depth": 1,
                }));
            }
        }
    }

    while let Some((sym, depth)) = queue.pop_front() {
        for (path, tree, source, lang) in &file_entries {
            if structure_available
                && matches!(lang, language::Lang::TypeScript | language::Lang::Tsx)
            {
                continue;
            }
            if matches!(lang, language::Lang::Python | language::Lang::Rust | language::Lang::Go | language::Lang::Java) {
                continue;
            }
            let references = symbols::extract_references(tree, source, path, &sym);
            for reference in references {
                let rel_file = make_relative(&reference.file, &root_str);
                let identity = (
                    sym.clone(),
                    rel_file.clone(),
                    reference.line,
                    reference.qualified_name.clone(),
                );
                affected_files.insert(rel_file.clone());
                if !changed_files.contains(&rel_file) {
                    has_cross_file_reference = true;
                }
                if seen_references.insert(identity) {
                    if affected_references.len() < MAX_AFFECTED_REFERENCES {
                        affected_references.push(json!({
                            "name": reference.name,
                            "qualified_name": reference.qualified_name,
                            "is_member": reference.qualified_name.is_some(),
                            "file": rel_file,
                            "line": reference.line,
                            "depth": depth,
                        }));
                    } else {
                        affected_references_truncated = true;
                    }
                }
            }
            let callers = symbols::extract_callers(tree, source, path, &sym, *lang);
            for caller in callers {
                let rel_file = make_relative(&caller.file, &root_str);
                affected_files.insert(rel_file.clone());
                if !visited.contains(&caller.name) {
                    visited.insert(caller.name.clone());
                    affected_functions.push(json!({
                        "name": caller.name,
                        "qualified_name": caller.qualified_name,
                        "is_member": caller.is_member,
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
    sort_evidence_values(&mut affected_functions);
    sort_evidence_values(&mut affected_references);

    let related_tests = find_related_tests(&changed_files, &affected_files, idx);
    let affected_files_sorted = sorted_hash_set_strings(&affected_files);
    let parse_errors = parse_errors_for_paths(idx, &affected_files, &root_str);
    let mut unresolved_module_specifiers = sorted_relation_values(&ts_relations, |relations| {
        &relations.unresolved_module_specifiers
    });
    unresolved_module_specifiers.extend(sorted_relation_values(&py_relations, |relations| {
        &relations.unresolved_module_specifiers
    }));
    unresolved_module_specifiers.extend(sorted_relation_values(&rust_relations, |relations| {
        &relations.unresolved_module_specifiers
    }));
    unresolved_module_specifiers.extend(sorted_relation_values(&go_relations, |relations| {
        &relations.unresolved_module_specifiers
    }));
    unresolved_module_specifiers.extend(sorted_relation_values(&java_relations, |relations| {
        &relations.unresolved_module_specifiers
    }));
    unresolved_module_specifiers.sort();
    unresolved_module_specifiers.dedup();
    let mut external_module_specifiers = sorted_relation_values(&ts_relations, |relations| {
        &relations.external_module_specifiers
    });
    external_module_specifiers.extend(sorted_relation_values(&py_relations, |relations| {
        &relations.external_module_specifiers
    }));
    external_module_specifiers.extend(sorted_relation_values(&rust_relations, |relations| {
        &relations.external_module_specifiers
    }));
    external_module_specifiers.extend(sorted_relation_values(&go_relations, |relations| {
        &relations.external_module_specifiers
    }));
    external_module_specifiers.extend(sorted_relation_values(&java_relations, |relations| {
        &relations.external_module_specifiers
    }));
    external_module_specifiers.sort();
    external_module_specifiers.dedup();
    let blocked_module_specifiers = sorted_relation_values(&ts_relations, |relations| {
        &relations.blocked_module_specifiers
    });
    let dynamic_import_files = sorted_relation_values(&ts_relations, |relations| {
        &relations.dynamic_import_files
    });
    let module_graph_cycle = ts_relations.values().any(|relations| relations.graph_cycle);
    let module_graph_truncated = ts_relations
        .values()
        .any(|relations| relations.graph_truncated);
    let unresolved_external_modules = ts_relations.values()
        .chain(py_relations.values())
        .chain(rust_relations.values())
        .chain(go_relations.values())
        .chain(java_relations.values())
        .any(|relations| {
        relations.targets.is_empty() && !relations.external_module_specifiers.is_empty()
    });
    let mut ambiguous_symbols = ambiguous_definition_symbols(
        idx,
        &seed_symbols
            .iter()
            .filter(|symbol| {
                (!ts_symbols.contains(*symbol)
                    && !py_symbols.contains(*symbol)
                    && !rust_symbols.contains(*symbol)
                    && !go_symbols.contains(*symbol)
                    && !java_symbols.contains(*symbol))
                    || non_ts_seed_symbols.contains(*symbol)
            })
            .cloned()
            .collect::<Vec<_>>(),
    );
    ambiguous_symbols.extend(ts_relations.iter().filter_map(|(symbol, relations)| {
        (relations.targets.len() > 1).then_some(symbol.clone())
    }));
    ambiguous_symbols.extend(py_relations.iter().filter_map(|(symbol, relations)| {
        (relations.targets.len() > 1).then_some(symbol.clone())
    }));
    ambiguous_symbols.extend(rust_relations.iter().filter_map(|(symbol, relations)| {
        (relations.targets.len() > 1).then_some(symbol.clone())
    }));
    ambiguous_symbols.extend(
        go_relations.iter().filter_map(|(symbol, relations)| {
            (relations.targets.len() > 1).then_some(symbol.clone())
        }),
    );
    ambiguous_symbols.extend(java_relations.iter().filter_map(|(symbol, relations)| {
        (relations.targets.len() > 1).then_some(symbol.clone())
    }));
    ambiguous_symbols.sort();
    ambiguous_symbols.dedup();
    let confidence = if seed_symbols.is_empty() {
        "low"
    } else if !outside_workspace_files.is_empty() {
        "medium"
    } else if !parse_errors.is_empty()
        || !unresolved_module_specifiers.is_empty()
        || !ambiguous_symbols.is_empty()
        || unresolved_external_modules
        || !blocked_module_specifiers.is_empty()
        || !dynamic_import_files.is_empty()
        || module_graph_cycle
        || module_graph_truncated
        || (!ts_seed_symbols.is_empty() && !structure_verified)
        || (!py_seed_symbols.is_empty() && !py_structure_verified)
        || (!rust_seed_symbols.is_empty() && !rust_structure_verified)
        || (!go_seed_symbols.is_empty() && !go_structure_verified)
        || (!java_seed_symbols.is_empty() && !java_structure_verified)
    {
        "medium"
    } else if affected_functions.is_empty() && !has_cross_file_reference {
        "medium"
    } else {
        "high"
    };
    let mut missing_evidence = if seed_symbols.is_empty() {
        vec!["seed_symbols"]
    } else if affected_functions.is_empty() && !has_cross_file_reference {
        vec!["no_static_callers_or_references"]
    } else {
        Vec::new()
    };
    if !parse_errors.is_empty() {
        missing_evidence.push("parse_errors");
    }
    if seed_symbols_truncated {
        missing_evidence.push("seed_symbols_truncated");
    }
    if affected_references_truncated {
        missing_evidence.push("affected_references_truncated");
    }
    if !unresolved_module_specifiers.is_empty() {
        missing_evidence.push("module_resolution");
    }
    if !ambiguous_symbols.is_empty() {
        missing_evidence.push("ambiguous_definitions");
    }
    if unresolved_external_modules {
        missing_evidence.push("external_module_resolution");
    }
    if !blocked_module_specifiers.is_empty() {
        missing_evidence.push("blocked_module_path");
    }
    if !dynamic_import_files.is_empty() {
        missing_evidence.push("dynamic_imports");
    }
    if module_graph_cycle {
        missing_evidence.push("module_graph_cycle");
    }
    if module_graph_truncated {
        missing_evidence.push("module_graph_truncated");
    }
    if !ts_seed_symbols.is_empty() && !structure_verified {
        missing_evidence.push("typescript_program");
    }
    if !py_seed_symbols.is_empty() && !py_structure_verified {
        missing_evidence.push("pyright_program");
    }
    if !rust_seed_symbols.is_empty() && !rust_structure_verified {
        missing_evidence.push("rust_analyzer_program");
    }
    if !go_seed_symbols.is_empty() && !go_structure_verified {
        missing_evidence.push("gopls_program");
    }
    if !java_seed_symbols.is_empty() && !java_structure_verified {
        missing_evidence.push("jdtls_program");
    }
    let mut suggested_minimal_reads: Vec<Value> = affected_files_sorted
        .iter()
        .map(|file| read_hint(file.clone(), 1, "affected file"))
        .collect();
    for test in related_tests.iter().take(6) {
        push_read_hint_unique(&mut suggested_minimal_reads, test.clone(), 1, "related test");
    }
    let minimal_reads_truncated = truncate_impact_minimal_reads(&mut suggested_minimal_reads);
    if minimal_reads_truncated {
        missing_evidence.push("minimal_reads_truncated");
    }
    if !outside_workspace_files.is_empty() {
        missing_evidence.push("outside_workspace");
    }

    let mut result = json!({
        "affected_files": affected_files_sorted,
        "affected_functions": affected_functions,
        "affected_references": affected_references,
        "affected_references_truncated": affected_references_truncated,
        "minimal_reads_truncated": minimal_reads_truncated,
        "related_tests": related_tests,
        "seed_symbols": seed_symbols,
        "seed_symbols_truncated": seed_symbols_truncated,
        "parse_errors": parse_errors,
        "unresolved_module_specifiers": unresolved_module_specifiers,
        "external_module_specifiers": external_module_specifiers,
        "blocked_module_specifiers": blocked_module_specifiers,
        "dynamic_import_files": dynamic_import_files,
        "module_graph_cycle": module_graph_cycle,
        "module_graph_truncated": module_graph_truncated,
        "ambiguous_symbols": ambiguous_symbols,
        "index_consistency": "targeted",
        "max_staleness_ms": 0,
        "semantic_engine": "language_semantic_programs",
        "semantic_engine_status": structure.status,
        "semantic_engine_reason": structure.reason,
        "semantic_snapshot_id": structure.snapshot_id,
        "program_build_count": structure.program_build_count,
        "program_rebuilt": structure.program_rebuilt,
        "semantic_elapsed_ms": structure.elapsed_ms,
        "python_semantic_engine_status": py_structure.status,
        "python_semantic_engine_reason": py_structure.reason,
        "python_semantic_snapshot_id": py_structure.snapshot_id,
        "python_program_build_count": py_structure.program_build_count,
        "python_program_rebuilt": py_structure.program_rebuilt,
        "python_semantic_elapsed_ms": py_structure.elapsed_ms,
        "rust_semantic_engine_status": rust_structure.status,
        "rust_semantic_engine_reason": rust_structure.reason,
        "rust_semantic_snapshot_id": rust_structure.snapshot_id,
        "rust_program_build_count": rust_structure.program_build_count,
        "rust_program_rebuilt": rust_structure.program_rebuilt,
        "rust_semantic_elapsed_ms": rust_structure.elapsed_ms,
        "java_semantic_engine_status": java_structure.status,
        "java_semantic_engine_reason": java_structure.reason,
        "java_semantic_snapshot_id": java_structure.snapshot_id,
        "java_program_build_count": java_structure.program_build_count,
        "java_program_rebuilt": java_structure.program_rebuilt,
        "java_semantic_elapsed_ms": java_structure.elapsed_ms,
        "truncated": {
            "seed_symbols": seed_symbols_truncated,
            "affected_references": affected_references_truncated,
            "minimal_reads": minimal_reads_truncated,
        },
        "answer_pack": build_answer_pack(
            "impact",
            confidence,
            seed_symbols.iter().take(8).map(|name| json!({ "name": name })).collect(),
            affected_functions.clone(),
            sorted_hash_set_strings(&affected_files),
            related_tests,
            vec![
                "upstream callers",
                "permission and approval boundary",
                "tool result and evidence recording",
                "related tests",
            ],
            suggested_minimal_reads,
            missing_evidence,
        ),
    });
    result["go_semantic_engine_status"] = json!(go_structure.status);
    result["go_semantic_engine_reason"] = json!(go_structure.reason);
    result["go_semantic_snapshot_id"] = json!(go_structure.snapshot_id);
    result["go_program_build_count"] = json!(go_structure.program_build_count);
    result["go_program_rebuilt"] = json!(go_structure.program_rebuilt);
    result["go_semantic_elapsed_ms"] = json!(go_structure.elapsed_ms);
    result["outside_workspace_files"] = json!(outside_workspace_files);
    result["not_covered_files"] = json!(outside_workspace_files);

    tool_success("pre_impact", result)
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

fn sort_evidence_values(values: &mut [Value]) {
    values.sort_by(|left, right| evidence_sort_key(left).cmp(&evidence_sort_key(right)));
}

fn evidence_sort_key(value: &Value) -> (String, u64, String, String, u64) {
    (
        value
            .get("file")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        value.get("line").and_then(Value::as_u64).unwrap_or_default(),
        value
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        value
            .get("qualified_name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        value.get("depth").and_then(Value::as_u64).unwrap_or_default(),
    )
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

fn python_lsp_inputs(
    idx: &Index,
    root_str: &str,
    files: &[String],
    symbols: &[String],
) -> (Vec<Value>, Vec<Value>) {
    let file_set: HashSet<&str> = files.iter().map(String::as_str).collect();
    let symbol_set: HashSet<String> = symbols.iter().cloned().collect();
    let mut symbol_positions = Vec::new();
    let mut import_tokens = Vec::new();
    for entry in idx.files().filter(|entry| entry.lang == language::Lang::Python) {
        let file = make_relative(&entry.path.to_string_lossy(), root_str);
        if !file_set.contains(file.as_str()) {
            continue;
        }
        if !symbol_set.is_empty() {
            symbol_positions.extend(
                symbols::extract_python_symbol_positions(&entry.tree, &entry.source, &symbol_set)
                    .into_iter()
                    .map(|position| json!({
                        "file": file,
                        "symbol": position.name,
                        "line": position.line,
                        "character": position.character,
                    })),
            );
        }
        import_tokens.extend(
            symbols::extract_python_import_tokens(&entry.tree, &entry.source)
                .into_iter()
                .filter_map(|position| position.specifier.map(|specifier| json!({
                    "file": file,
                    "specifier": specifier,
                    "line": position.line,
                    "character": position.character,
                }))),
        );
    }
    (symbol_positions, import_tokens)
}

fn rust_lsp_inputs(
    idx: &Index,
    root_str: &str,
    files: &[String],
    symbols: &[String],
) -> (Vec<Value>, Vec<Value>) {
    let file_set: HashSet<String> = files.iter().map(|file| make_relative(file, root_str)).collect();
    let symbol_set: HashSet<String> = symbols.iter().cloned().collect();
    let mut symbol_positions = Vec::new();
    let mut import_tokens = Vec::new();
    for entry in idx.files().filter(|entry| entry.lang == language::Lang::Rust) {
        let file = make_relative(&entry.path.to_string_lossy(), root_str);
        if !file_set.contains(&file) { continue; }
        if !symbol_set.is_empty() {
            symbol_positions.extend(
                symbols::extract_rust_symbol_positions(&entry.tree, &entry.source, &symbol_set)
                    .into_iter()
                    .map(|position| json!({
                        "file": file, "symbol": position.name,
                        "line": position.line, "character": position.character,
                    })),
            );
        }
        import_tokens.extend(
            symbols::extract_rust_import_tokens(&entry.tree, &entry.source)
                .into_iter()
                .filter_map(|position| position.specifier.map(|specifier| json!({
                    "file": file, "specifier": specifier,
                    "line": position.line, "character": position.character,
                }))),
        );
    }
    (symbol_positions, import_tokens)
}

fn go_lsp_inputs(
    idx: &Index,
    root_str: &str,
    files: &[String],
    target_symbols: &[String],
) -> (Vec<Value>, Vec<Value>) {
    let file_set: HashSet<String> = files
        .iter()
        .map(|file| make_relative(file, root_str))
        .collect();
    let symbol_set: HashSet<&str> = target_symbols.iter().map(String::as_str).collect();
    let mut symbol_positions = Vec::new();
    let mut import_tokens = Vec::new();
    for entry in idx.files().filter(|entry| entry.lang == language::Lang::Go) {
        let file = make_relative(&entry.path.to_string_lossy(), root_str);
        if !file_set.contains(&file) {
            continue;
        }
        for symbol in &symbol_set {
            let reference_lines: HashSet<usize> =
                symbols::extract_references(&entry.tree, &entry.source, &entry.path, symbol)
                    .into_iter()
                    .map(|reference| reference.line)
                    .collect();
            for (line_index, line) in entry.source.lines().enumerate() {
                if !reference_lines.contains(&(line_index + 1)) {
                    continue;
                }
                for character in lsp_symbol_characters(line, symbol) {
                    symbol_positions.push(json!({
                        "file": file,
                        "symbol": symbol,
                        "line": line_index,
                        "character": character,
                    }));
                }
            }
        }
        for specifier in symbols::extract_imports(&entry.tree, &entry.source, language::Lang::Go) {
            for (line_index, line) in entry.source.lines().enumerate() {
                for character in lsp_symbol_characters(line, &specifier) {
                    import_tokens.push(json!({
                        "file": file,
                        "specifier": specifier,
                        "line": line_index,
                        "character": character,
                    }));
                }
            }
        }
    }
    (symbol_positions, import_tokens)
}

fn lsp_symbol_characters(line: &str, symbol: &str) -> Vec<usize> {
    line.match_indices(symbol)
        .filter_map(|(byte_offset, _)| {
            let before = line[..byte_offset].chars().next_back();
            let after = line[byte_offset + symbol.len()..].chars().next();
            let is_identifier = |character: char| character == '_' || character.is_alphanumeric();
            if before.is_some_and(is_identifier) || after.is_some_and(is_identifier) {
                None
            } else {
                Some(line[..byte_offset].encode_utf16().count())
            }
        })
        .collect()
}

fn java_lsp_inputs(
    idx: &Index,
    root_str: &str,
    files: &[String],
    symbols: &[String],
) -> (Vec<Value>, Vec<Value>, Vec<Value>) {
    let file_set: HashSet<String> = files.iter().map(|file| make_relative(file, root_str)).collect();
    let symbol_set: HashSet<String> = symbols.iter().cloned().collect();
    let mut symbol_positions = Vec::new();
    let mut import_tokens = Vec::new();
    let mut dependency_tokens = Vec::new();
    for entry in idx.files().filter(|entry| entry.lang == language::Lang::Java) {
        let file = make_relative(&entry.path.to_string_lossy(), root_str);
        if !file_set.contains(&file) { continue; }
        if !symbol_set.is_empty() {
            symbol_positions.extend(
                symbols::extract_java_symbol_positions(&entry.tree, &entry.source, &symbol_set)
                    .into_iter()
                    .map(|position| json!({
                        "file": file, "symbol": position.name,
                        "line": position.line, "character": position.character,
                    })),
            );
        }
        import_tokens.extend(
            symbols::extract_java_import_tokens(&entry.tree, &entry.source)
                .into_iter()
                .filter_map(|position| {
                    let specifier = position.specifier?;
                    specifier.starts_with("import ").then(|| json!({
                        "file": file, "specifier": specifier,
                        "line": position.line, "character": position.character,
                    }))
                }),
        );
        dependency_tokens.extend(
            symbols::extract_java_symbol_positions(&entry.tree, &entry.source, &HashSet::new())
                .into_iter()
                .map(|position| json!({
                    "file": file, "symbol": position.name,
                    "line": position.line, "character": position.character,
                })),
        );
    }
    (symbol_positions, import_tokens, dependency_tokens)
}

fn handle_pre_plan(
    arguments: &Value,
    index: &mut Option<Index>,
    deep_layer: &mut Option<ts_deep_layer::DeepLayer>,
    py_layer: &mut Option<py_deep_layer::PyDeepLayer>,
    rust_layer: &mut Option<rust_deep_layer::RustDeepLayer>,
    go_layer: &mut Option<go_deep_layer::GoDeepLayer>,
    java_layer: &mut Option<java_deep_layer::JavaDeepLayer>,
) -> Value {
    let idx = match index.as_mut() {
        Some(i) => i,
        None => return tool_error("index not initialized — send initialize with rootUri first"),
    };
    let root_str = idx.root.to_string_lossy().to_string();

    let requested_target_files: Vec<String> = arguments
        .get("target_files")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|s| s.as_str().map(String::from)).collect())
        .unwrap_or_default();
    let has_target_files = !requested_target_files.is_empty();
    if let Some(result) = reject_non_structural_paths("pre_plan", &requested_target_files) {
        return result;
    }
    let target_symbols: Vec<String> = arguments
        .get("target_symbols")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|s| s.as_str().map(String::from)).collect())
        .unwrap_or_default();
    let (target_files, mut outside_workspace_files, index_consistency) = if !has_target_files {
        (
            Vec::new(),
            Vec::new(),
            if idx.refresh() {
                "full"
            } else {
                "bounded_stale"
            },
        )
    } else {
        let (accepted, rejected) = idx.refresh_paths(&requested_target_files);
        (accepted, rejected, "targeted")
    };
    if has_target_files && target_files.is_empty() {
        return tool_success("pre_plan", json!({
            "status": "not_covered",
            "reason": "outside_workspace",
            "outside_workspace_files": outside_workspace_files,
            "not_covered_files": outside_workspace_files,
            "task": arguments.get("task").and_then(Value::as_str).unwrap_or(""),
        }));
    }

    let ts_files: Vec<String> = idx
        .files()
        .filter(|entry| matches!(entry.lang, language::Lang::TypeScript | language::Lang::Tsx))
        .map(|entry| make_relative(&entry.path.to_string_lossy(), &root_str))
        .collect();
    let structure_files = if !has_target_files {
        ts_files
    } else {
        target_files
            .iter()
            .filter(|file| {
                idx.files().any(|entry| {
                    matches!(entry.lang, language::Lang::TypeScript | language::Lang::Tsx)
                        && make_relative(&entry.path.to_string_lossy(), &root_str) == **file
                })
            })
            .cloned()
            .collect()
    };
    let ts_symbols_requested = if !has_target_files || !structure_files.is_empty() {
        target_symbols.clone()
    } else {
        Vec::new()
    };
    let mut structure = if !has_target_files {
        ts_deep_layer::run_structure(
            deep_layer,
            &idx.root,
            &structure_files,
            &ts_symbols_requested,
            &target_files,
        )
    } else if structure_files.is_empty() {
        ts_deep_layer::disabled_structure(&ts_symbols_requested)
    } else {
        let mut scoped_results = Vec::new();
        for scope in group_files_by_config_root(&idx.root, &structure_files, &["tsconfig.json"]) {
            let mut result = ts_deep_layer::run_structure(
                deep_layer,
                &scope.root,
                &scope.helper_files,
                &ts_symbols_requested,
                &scope.helper_files,
            );
            result.snapshot_id = scoped_snapshot_id(
                &idx.root,
                &scope.root,
                &scope.helper_files,
                &["tsconfig.json"],
                &result.snapshot_id,
            );
            let scope_name = config_scope_name(&idx.root, &scope.root);
            retain_scoped_structure_paths(
                idx,
                &scope_name,
                &mut result,
                &mut outside_workspace_files,
            );
            scoped_results.push((scope_name, result));
        }
        aggregate_scoped_structure_results(scoped_results)
    };
    if !has_target_files || structure_files.is_empty() {
        let input_snapshot_id = scoped_snapshot_id(
            &idx.root,
            &idx.root,
            &structure_files,
            &["tsconfig.json"],
            &structure.snapshot_id,
        );
        structure.snapshot_id = structure_snapshot_id(&input_snapshot_id, &structure);
    }
    let py_structure_files: Vec<String> = if !has_target_files {
        idx.files()
            .filter(|entry| entry.lang == language::Lang::Python)
            .map(|entry| make_relative(&entry.path.to_string_lossy(), &root_str))
            .collect()
    } else {
        target_files
            .iter()
            .filter(|file| {
                idx.files().any(|entry| {
                    entry.lang == language::Lang::Python
                        && make_relative(&entry.path.to_string_lossy(), &root_str) == **file
                })
            })
            .cloned()
            .collect()
    };
    let mut py_structure = if py_structure_files.is_empty() {
        py_deep_layer::disabled_structure(&target_symbols)
    } else {
        let scopes = if !has_target_files {
            vec![ConfigScope {
                root: idx.root.clone(),
                workspace_files: py_structure_files.clone(),
                helper_files: py_structure_files.clone(),
            }]
        } else {
            group_files_by_config_root(
                &idx.root,
                &py_structure_files,
                &["pyrightconfig.json", "pyproject.toml"],
            )
        };
        let mut scoped_results = Vec::new();
        for scope in scopes {
            let scope_name = config_scope_name(&idx.root, &scope.root);
            let scope_root = scope.root.to_string_lossy().to_string();
            let mut files = scope.helper_files;
            let (symbol_positions, _) =
                python_lsp_inputs(idx, &scope_root, &files, &target_symbols);
            let (_, import_tokens) = python_lsp_inputs(idx, &scope_root, &files, &[]);
            let mut result = py_deep_layer::run_structure(
                py_layer,
                &scope.root,
                &files,
                &target_symbols,
                &symbol_positions,
                &import_tokens,
            );
            for _ in 0..16 {
                let mut expanded: HashSet<String> = files.iter().cloned().collect();
                expanded.extend(result.module_dependencies.values().flatten().cloned());
                expanded.extend(
                    result
                        .relations
                        .values()
                        .flat_map(|relations| relations.related_files.iter().cloned()),
                );
                if expanded.len() == files.len() {
                    break;
                }
                let candidates: Vec<String> = expanded.into_iter().collect();
                let accepted = refresh_scoped_helper_paths(
                    idx,
                    &scope_name,
                    &candidates,
                    &mut outside_workspace_files,
                );
                if accepted == files {
                    break;
                }
                files = accepted;
                let (symbol_positions, import_tokens) =
                    python_lsp_inputs(idx, &scope_root, &files, &target_symbols);
                result = py_deep_layer::run_structure(
                    py_layer,
                    &scope.root,
                    &files,
                    &target_symbols,
                    &symbol_positions,
                    &import_tokens,
                );
            }
            let mut final_closure: HashSet<String> = files.iter().cloned().collect();
            final_closure.extend(result.module_dependencies.values().flatten().cloned());
            final_closure.extend(
                result
                    .relations
                    .values()
                    .flat_map(|relations| relations.related_files.iter().cloned()),
            );
            if final_closure.len() > files.len() {
                for relations in result.relations.values_mut() {
                    relations.graph_truncated = true;
                }
            }
            result.snapshot_id = scoped_snapshot_id(
                &idx.root,
                &scope.root,
                &files,
                &["pyrightconfig.json", "pyproject.toml"],
                &result.snapshot_id,
            );
            retain_scoped_structure_paths(
                idx,
                &scope_name,
                &mut result,
                &mut outside_workspace_files,
            );
            scoped_results.push((scope_name, result));
        }
        aggregate_scoped_structure_results(scoped_results)
    };
    let has_rust_files = idx.files().any(|entry| entry.lang == language::Lang::Rust);
    let rust_structure_files: Vec<String> = if !has_target_files {
        Vec::new()
    } else {
        target_files.iter().filter(|file| {
            idx.files().any(|entry| entry.lang == language::Lang::Rust
                && make_relative(&entry.path.to_string_lossy(), &root_str) == **file)
        }).cloned().collect()
    };
    let mut rust_structure = if !has_rust_files
        || (has_target_files && rust_structure_files.is_empty())
    {
        rust_deep_layer::disabled_structure(&target_symbols)
    } else {
        let scopes = if !has_target_files {
            vec![ConfigScope {
                root: idx.root.clone(),
                workspace_files: rust_structure_files.clone(),
                helper_files: rust_structure_files.clone(),
            }]
        } else {
            group_files_by_config_root(
                &idx.root,
                &rust_structure_files,
                &["Cargo.toml", "rust-project.json"],
            )
        };
        let mut scoped_results = Vec::new();
        for scope in scopes {
            let scope_name = config_scope_name(&idx.root, &scope.root);
            let scope_root = scope.root.to_string_lossy().to_string();
            let mut files = scope.helper_files;
            let (mut symbol_positions, mut import_tokens) =
                rust_lsp_inputs(idx, &scope_root, &files, &target_symbols);
            let mut result = rust_deep_layer::run_structure(
                rust_layer,
                &scope.root,
                &files,
                &target_symbols,
                &symbol_positions,
                &import_tokens,
                !has_target_files,
            );
            for _ in 0..15 {
                let mut expanded: HashSet<String> = files.iter().cloned().collect();
                expanded.extend(result.module_dependencies.values().flatten().cloned());
                expanded.extend(
                    result
                        .relations
                        .values()
                        .flat_map(|relations| relations.related_files.iter().cloned()),
                );
                if expanded.len() == files.len() {
                    break;
                }
                let candidates: Vec<String> = expanded.into_iter().collect();
                let accepted = refresh_scoped_helper_paths(
                    idx,
                    &scope_name,
                    &candidates,
                    &mut outside_workspace_files,
                );
                if accepted == files {
                    break;
                }
                files = accepted;
                (symbol_positions, import_tokens) =
                    rust_lsp_inputs(idx, &scope_root, &files, &target_symbols);
                result = rust_deep_layer::run_structure(
                    rust_layer,
                    &scope.root,
                    &files,
                    &target_symbols,
                    &symbol_positions,
                    &import_tokens,
                    false,
                );
            }
            let mut final_closure: HashSet<String> = files.iter().cloned().collect();
            final_closure.extend(result.module_dependencies.values().flatten().cloned());
            final_closure.extend(
                result
                    .relations
                    .values()
                    .flat_map(|relations| relations.related_files.iter().cloned()),
            );
            if final_closure.len() > files.len() {
                for relations in result.relations.values_mut() {
                    relations.graph_truncated = true;
                }
            }
            result.snapshot_id = scoped_snapshot_id(
                &idx.root,
                &scope.root,
                &files,
                &["Cargo.toml", "rust-project.json"],
                &result.snapshot_id,
            );
            retain_scoped_structure_paths(
                idx,
                &scope_name,
                &mut result,
                &mut outside_workspace_files,
            );
            scoped_results.push((scope_name, result));
        }
        aggregate_scoped_structure_results(scoped_results)
    };
    let rust_graph_truncated = rust_structure
        .relations
        .values()
        .any(|relations| relations.graph_truncated);
    let has_go_files = idx.files().any(|entry| entry.lang == language::Lang::Go);
    let mut go_structure_files: Vec<String> = if !has_target_files {
        Vec::new()
    } else {
        target_files
            .iter()
            .filter(|file| {
                idx.files().any(|entry| {
                    entry.lang == language::Lang::Go
                        && make_relative(&entry.path.to_string_lossy(), &root_str) == **file
                })
            })
            .cloned()
            .collect()
    };
    let (go_symbol_positions, _) =
        go_lsp_inputs(idx, &root_str, &go_structure_files, &target_symbols);
    let (_, go_import_tokens) = go_lsp_inputs(idx, &root_str, &go_structure_files, &[]);
    let mut go_structure = if !has_go_files
        || (has_target_files && go_structure_files.is_empty())
    {
        go_deep_layer::disabled_structure(&target_symbols)
    } else {
        go_deep_layer::run_structure(
            go_layer,
            &idx.root,
            &go_structure_files,
            &target_symbols,
            &go_symbol_positions,
            &go_import_tokens,
            !has_target_files,
            "full",
            false,
            true,
        )
    };
    for _ in 0..15 {
        let mut expanded: HashSet<String> = go_structure_files.iter().cloned().collect();
        expanded.extend(go_structure.module_dependencies.values().flatten().cloned());
        expanded.extend(
            go_structure
                .relations
                .values()
                .flat_map(|relations| relations.related_files.iter().cloned()),
        );
        if expanded.len() == go_structure_files.len() {
            break;
        }
        let current_files: HashSet<String> = go_structure_files.iter().cloned().collect();
        let mut candidates: Vec<String> = expanded.difference(&current_files).cloned().collect();
        candidates.sort();
        let (new_files, rejected) = idx.refresh_paths(&candidates);
        outside_workspace_files.extend(rejected);
        if new_files.is_empty() {
            break;
        }
        go_structure_files.extend(new_files.iter().cloned());
        go_structure_files.sort();
        go_structure_files.dedup();
        let (_, expanded_import_tokens) = go_lsp_inputs(idx, &root_str, &new_files, &[]);
        let expansion = go_deep_layer::run_structure(
            go_layer,
            &idx.root,
            &new_files,
            &[],
            &[],
            &expanded_import_tokens,
            false,
            "reuse",
            false,
            false,
        );
        if go_structure.status == "verified" && expansion.status != "verified" {
            go_structure.status = expansion.status;
            go_structure.reason = expansion.reason;
        }
        go_structure.module_dependencies.extend(expansion.module_dependencies);
        go_structure.program_build_count = go_structure.program_build_count.max(expansion.program_build_count);
        go_structure.program_rebuilt |= expansion.program_rebuilt;
        if expansion.snapshot_id != "0" {
            go_structure.snapshot_id = expansion.snapshot_id;
        }
        go_structure.elapsed_ms += expansion.elapsed_ms;
    }
    retain_workspace_structure_paths(idx, &mut go_structure, &mut outside_workspace_files);
    let mut final_go_closure: HashSet<String> = go_structure_files.iter().cloned().collect();
    final_go_closure.extend(go_structure.module_dependencies.values().flatten().cloned());
    final_go_closure.extend(
        go_structure
            .relations
            .values()
            .flat_map(|relations| relations.related_files.iter().cloned()),
    );
    let go_graph_truncated = final_go_closure.len() > go_structure_files.len();
    if go_graph_truncated {
        for relations in go_structure.relations.values_mut() {
            relations.graph_truncated = true;
        }
    }
    if has_go_files && (!has_target_files || !go_structure_files.is_empty()) {
        let mut snapshot_files: Vec<String> = if has_target_files {
            final_go_closure.iter().cloned().collect()
        } else {
            idx.files()
                .filter(|entry| entry.lang == language::Lang::Go)
                .map(|entry| make_relative(&entry.path.to_string_lossy(), &root_str))
                .collect()
        };
        snapshot_files.sort();
        snapshot_files.dedup();
        let input_snapshot_id = scoped_snapshot_id(
            &idx.root,
            &idx.root,
            &snapshot_files,
            &["go.mod", "go.work"],
            &go_structure.snapshot_id,
        );
        go_structure.snapshot_id = structure_snapshot_id(&input_snapshot_id, &go_structure);
    }

    let has_java_files = idx.files().any(|entry| entry.lang == language::Lang::Java);
    let mut java_structure_files: Vec<String> = if !has_target_files {
        Vec::new()
    } else {
        target_files.iter()
            .filter(|file| language::Lang::from_path(Path::new(file)) == Some(language::Lang::Java))
            .cloned().collect()
    };
    let (java_symbol_positions, java_import_tokens, java_dependency_tokens) =
        java_lsp_inputs(idx, &root_str, &java_structure_files, &target_symbols);
    let mut java_structure = if (!has_java_files && !has_target_files)
        || (has_target_files && java_structure_files.is_empty())
    {
        java_deep_layer::disabled_structure(&target_symbols)
    } else {
        java_deep_layer::run_structure(
            java_layer, &idx.root, &java_structure_files, &target_symbols,
            &java_symbol_positions, &java_import_tokens, &java_dependency_tokens,
            !has_target_files,
        )
    };
    for _ in 0..MAX_JAVA_PLAN_CLOSURE_ROUNDS {
        let mut expanded: HashSet<String> = java_structure_files.iter().cloned().collect();
        expanded.extend(java_structure.module_dependencies.values().flatten().cloned());
        expanded.extend(
            java_structure
                .relations
                .values()
                .flat_map(|relations| relations.related_files.iter().cloned()),
        );
        if expanded.len() == java_structure_files.len() {
            break;
        }
        let current_files: HashSet<String> = java_structure_files.iter().cloned().collect();
        let mut candidates: Vec<String> = expanded.difference(&current_files).cloned().collect();
        candidates.sort();
        let (new_files, rejected) = idx.refresh_paths(&candidates);
        outside_workspace_files.extend(rejected);
        if new_files.is_empty() {
            break;
        }
        java_structure_files.extend(new_files);
        java_structure_files.sort();
        java_structure_files.dedup();
        let (_, expanded_import_tokens, expanded_dependency_tokens) =
            java_lsp_inputs(idx, &root_str, &java_structure_files, &[]);
        java_structure = java_deep_layer::run_structure(
            java_layer,
            &idx.root,
            &java_structure_files,
            &target_symbols,
            &java_symbol_positions,
            &expanded_import_tokens,
            &expanded_dependency_tokens,
            !has_target_files,
        );
    }
    retain_workspace_structure_paths(idx, &mut java_structure, &mut outside_workspace_files);
    let mut final_java_closure: HashSet<String> = java_structure_files.iter().cloned().collect();
    final_java_closure.extend(java_structure.module_dependencies.values().flatten().cloned());
    final_java_closure.extend(
        java_structure
            .relations
            .values()
            .flat_map(|relations| relations.related_files.iter().cloned()),
    );
    let java_graph_truncated = final_java_closure.len() > java_structure_files.len();
    if java_graph_truncated {
        for relations in java_structure.relations.values_mut() {
            relations.graph_truncated = true;
        }
    }
    if has_java_files && (!has_target_files || !java_structure_files.is_empty()) {
        let mut snapshot_files: Vec<String> = if has_target_files {
            final_java_closure.iter().cloned().collect()
        } else {
            idx.files()
                .filter(|entry| entry.lang == language::Lang::Java)
                .map(|entry| make_relative(&entry.path.to_string_lossy(), &root_str))
                .collect()
        };
        snapshot_files.sort();
        snapshot_files.dedup();
        let input_snapshot_id = scoped_snapshot_id(
            &idx.root,
            &idx.root,
            &snapshot_files,
            &["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"],
            &java_structure.snapshot_id,
        );
        java_structure.snapshot_id = structure_snapshot_id(&input_snapshot_id, &java_structure);
    }
    retain_workspace_structure_paths(idx, &mut structure, &mut outside_workspace_files);
    retain_workspace_structure_paths(idx, &mut py_structure, &mut outside_workspace_files);
    retain_workspace_structure_paths(idx, &mut rust_structure, &mut outside_workspace_files);
    outside_workspace_files.sort();
    outside_workspace_files.dedup();
    let ts_relations = structure.relations.clone();
    let py_relations = py_structure.relations.clone();
    let rust_relations = rust_structure.relations.clone();
    let go_relations = go_structure.relations.clone();
    let java_relations = java_structure.relations.clone();
    let structure_verified = structure.status == "verified";
    let structure_available = structure.status != "tool_missing";
    let py_structure_verified = py_structure.status == "verified";
    let py_structure_available = matches!(py_structure.status, "verified" | "partially_verified");
    let rust_structure_verified = rust_structure.status == "verified";
    let rust_structure_available = matches!(rust_structure.status, "verified" | "partially_verified");
    let go_structure_verified = go_structure.status == "verified";
    let go_structure_available = matches!(go_structure.status, "verified" | "partially_verified");
    let java_structure_verified = java_structure.status == "verified";
    let java_structure_available = matches!(java_structure.status, "verified" | "partially_verified");
    let ts_target_files: HashSet<String> = target_files
        .iter()
        .filter(|file| {
            idx.files().any(|entry| {
                make_relative(&entry.path.to_string_lossy(), &root_str) == **file
                    && matches!(entry.lang, language::Lang::TypeScript | language::Lang::Tsx)
            })
        })
        .cloned()
        .collect();
    let py_target_files: HashSet<String> = target_files
        .iter()
        .filter(|file| py_structure_files.contains(file))
        .cloned()
        .collect();
    let rust_target_files: HashSet<String> = target_files.iter()
        .filter(|file| rust_structure_files.contains(file)).cloned().collect();
    let go_target_files: HashSet<String> = target_files
        .iter()
        .filter(|file| go_structure_files.contains(file))
        .cloned()
        .collect();
    let java_target_files: HashSet<String> = target_files.iter()
        .filter(|file| java_structure_files.contains(file)).cloned().collect();
    let non_ts_target_symbols: HashSet<String> = idx
        .files()
        .filter(|entry| {
            let rel = make_relative(&entry.path.to_string_lossy(), &root_str);
            target_files.contains(&rel)
                && !matches!(entry.lang, language::Lang::TypeScript | language::Lang::Tsx | language::Lang::Python | language::Lang::Rust | language::Lang::Go)
                && !matches!(entry.lang, language::Lang::TypeScript | language::Lang::Tsx | language::Lang::Python | language::Lang::Rust | language::Lang::Java)
        })
        .flat_map(|entry| {
            symbols::extract_definitions(&entry.tree, &entry.source, &entry.path, entry.lang)
                .into_iter()
                .map(|definition| definition.name)
                .collect::<Vec<_>>()
        })
        .collect();
    let ts_symbols: HashSet<String> = ts_relations
        .iter()
        .filter_map(|(symbol, relations)| {
            (relations.has_evidence()
                || (structure_available
                    && !ts_target_files.is_empty()
                    && !non_ts_target_symbols.contains(symbol)))
                .then_some(symbol.clone())
        })
        .collect();
    let py_symbols: HashSet<String> = py_relations
        .iter()
        .filter_map(|(symbol, relations)| {
            (relations.has_evidence()
                || (py_structure_available
                    && !py_target_files.is_empty()
                    && !non_ts_target_symbols.contains(symbol)))
                .then_some(symbol.clone())
        })
        .collect();
    let rust_symbols: HashSet<String> = rust_relations.iter().filter_map(|(symbol, relations)| {
        (relations.has_evidence()
            || (rust_structure_available && !rust_target_files.is_empty()
                && !non_ts_target_symbols.contains(symbol)))
        .then_some(symbol.clone())
    }).collect();
    let go_symbols: HashSet<String> = go_relations
        .iter()
        .filter_map(|(symbol, relations)| {
        (relations.has_evidence()
                || (go_structure_available
                    && !go_target_files.is_empty()
                && !non_ts_target_symbols.contains(symbol)))
        .then_some(symbol.clone())
        })
        .collect();
    let java_symbols: HashSet<String> = java_relations.iter().filter_map(|(symbol, relations)| {
        (relations.has_evidence()
            || (java_structure_available && !java_target_files.is_empty()
                && !non_ts_target_symbols.contains(symbol)))
        .then_some(symbol.clone())
    }).collect();
    let mut unresolved_module_specifiers = sorted_relation_values(&ts_relations, |relations| {
        &relations.unresolved_module_specifiers
    });
    unresolved_module_specifiers.extend(sorted_relation_values(&py_relations, |relations| {
        &relations.unresolved_module_specifiers
    }));
    unresolved_module_specifiers.extend(sorted_relation_values(&rust_relations, |relations| {
        &relations.unresolved_module_specifiers
    }));
    unresolved_module_specifiers.extend(sorted_relation_values(&go_relations, |relations| {
        &relations.unresolved_module_specifiers
    }));
    unresolved_module_specifiers.extend(sorted_relation_values(&java_relations, |relations| {
        &relations.unresolved_module_specifiers
    }));
    unresolved_module_specifiers.sort();
    unresolved_module_specifiers.dedup();
    let mut external_module_specifiers = sorted_relation_values(&ts_relations, |relations| {
        &relations.external_module_specifiers
    });
    external_module_specifiers.extend(sorted_relation_values(&py_relations, |relations| {
        &relations.external_module_specifiers
    }));
    external_module_specifiers.extend(sorted_relation_values(&rust_relations, |relations| {
        &relations.external_module_specifiers
    }));
    external_module_specifiers.extend(sorted_relation_values(&go_relations, |relations| {
        &relations.external_module_specifiers
    }));
    external_module_specifiers.extend(sorted_relation_values(&java_relations, |relations| {
        &relations.external_module_specifiers
    }));
    external_module_specifiers.sort();
    external_module_specifiers.dedup();
    let blocked_module_specifiers = sorted_relation_values(&ts_relations, |relations| {
        &relations.blocked_module_specifiers
    });
    let dynamic_import_files =
        sorted_relation_values(&ts_relations, |relations| &relations.dynamic_import_files);
    let module_graph_cycle = ts_relations
        .values()
        .chain(py_relations.values())
        .chain(rust_relations.values())
        .chain(go_relations.values())
        .chain(java_relations.values())
        .any(|relations| relations.graph_cycle);
    let module_graph_truncated = ts_relations
        .values()
        .chain(py_relations.values())
        .chain(rust_relations.values())
        .chain(go_relations.values())
        .chain(java_relations.values())
        .any(|relations| relations.graph_truncated)
        || rust_graph_truncated
        || go_graph_truncated
        || java_graph_truncated;
    let unresolved_external_modules = ts_relations
        .values()
        .chain(py_relations.values())
        .chain(rust_relations.values())
        .chain(go_relations.values())
        .chain(java_relations.values())
        .any(|relations| {
        relations.targets.is_empty() && !relations.external_module_specifiers.is_empty()
    });
    let mut ambiguous_symbols = ambiguous_definition_symbols(
        idx,
        &target_symbols
            .iter()
            .filter(|symbol| {
                (!ts_symbols.contains(*symbol)
                    && !py_symbols.contains(*symbol)
                    && !rust_symbols.contains(*symbol)
                    && !go_symbols.contains(*symbol)
                    && !java_symbols.contains(*symbol))
                    || non_ts_target_symbols.contains(*symbol)
            })
            .cloned()
            .collect::<Vec<_>>(),
    );
    ambiguous_symbols.extend(
        ts_relations.iter().filter_map(|(symbol, relations)| {
        (relations.targets.len() > 1).then_some(symbol.clone())
        }),
    );
    ambiguous_symbols.extend(
        py_relations.iter().filter_map(|(symbol, relations)| {
        (relations.targets.len() > 1).then_some(symbol.clone())
        }),
    );
    ambiguous_symbols.extend(
        rust_relations.iter().filter_map(|(symbol, relations)| {
        (relations.targets.len() > 1).then_some(symbol.clone())
        }),
    );
    ambiguous_symbols.extend(
        go_relations.iter().filter_map(|(symbol, relations)| {
            (relations.targets.len() > 1).then_some(symbol.clone())
        }),
    );
    ambiguous_symbols.extend(java_relations.iter().filter_map(|(symbol, relations)| {
        (relations.targets.len() > 1).then_some(symbol.clone())
    }));
    ambiguous_symbols.sort();
    ambiguous_symbols.dedup();

    let mut scope_files: HashSet<String> = target_files.iter().cloned().collect();
    let mut target_definition_found = false;
    if !py_target_files.is_empty() {
        for (file, dependencies) in &py_structure.module_dependencies {
            scope_files.insert(file.clone());
            scope_files.extend(dependencies.iter().cloned());
        }
    }
    if !rust_target_files.is_empty() {
        for (file, dependencies) in &rust_structure.module_dependencies {
            scope_files.insert(file.clone());
            scope_files.extend(dependencies.iter().cloned());
        }
    }
    if !go_target_files.is_empty() {
        for (file, dependencies) in &go_structure.module_dependencies {
            scope_files.insert(file.clone());
            scope_files.extend(dependencies.iter().cloned());
        }
    }
    if !java_target_files.is_empty() {
        for (file, dependencies) in &java_structure.module_dependencies {
            scope_files.insert(file.clone());
            scope_files.extend(dependencies.iter().cloned());
        }
    }

    if !target_symbols.is_empty() {
        for relations in ts_relations.values() {
            scope_files.extend(relations.related_files.iter().cloned());
            if relations.targets.len() == 1 {
                target_definition_found = true;
            } else {
                scope_files.extend(relations.targets.iter().map(|target| target.file.clone()));
            }
        }
        for relations in py_relations.values() {
            scope_files.extend(relations.related_files.iter().cloned());
            if relations.targets.len() == 1 {
                target_definition_found = true;
            } else {
                scope_files.extend(relations.targets.iter().map(|target| target.file.clone()));
            }
        }
        for relations in rust_relations.values() {
            scope_files.extend(relations.related_files.iter().cloned());
            if relations.targets.len() == 1 {
                target_definition_found = true;
            } else {
                scope_files.extend(relations.targets.iter().map(|target| target.file.clone()));
            }
        }
        for relations in go_relations.values() {
            scope_files.extend(relations.related_files.iter().cloned());
            if relations.targets.len() == 1 {
                target_definition_found = true;
            } else {
                scope_files.extend(relations.targets.iter().map(|target| target.file.clone()));
            }
        }
        for relations in java_relations.values() {
            scope_files.extend(relations.related_files.iter().cloned());
            if relations.targets.len() == 1 { target_definition_found = true; }
            else { scope_files.extend(relations.targets.iter().map(|target| target.file.clone())); }
        }
        for entry in idx.files() {
            let rel = make_relative(&entry.path.to_string_lossy(), &root_str);
            if structure_available
                && matches!(entry.lang, language::Lang::TypeScript | language::Lang::Tsx)
            {
                continue;
            }
            if matches!(entry.lang, language::Lang::Python | language::Lang::Rust | language::Lang::Go | language::Lang::Java) {
                continue;
            }
            let defs =
                symbols::extract_definitions(&entry.tree, &entry.source, &entry.path, entry.lang);
            if defs.iter().any(|definition| {
                target_symbols.contains(&definition.name)
                    && ((!ts_symbols.contains(&definition.name)
                        && !py_symbols.contains(&definition.name)
                        && !rust_symbols.contains(&definition.name)
                        && !go_symbols.contains(&definition.name)
                        && !java_symbols.contains(&definition.name))
                        || non_ts_target_symbols.contains(&definition.name))
            }) {
                target_definition_found = true;
                scope_files.insert(rel.clone());
            }
            for symbol in &target_symbols {
                if (ts_symbols.contains(symbol)
                    || py_symbols.contains(symbol)
                    || rust_symbols.contains(symbol)
                    || go_symbols.contains(symbol)
                    || java_symbols.contains(symbol))
                    && !non_ts_target_symbols.contains(symbol)
                {
                    continue;
                }
                if !symbols::extract_references(&entry.tree, &entry.source, &entry.path, symbol)
                    .is_empty()
                    || !symbols::extract_callers(
                        &entry.tree,
                        &entry.source,
                        &entry.path,
                        symbol,
                        entry.lang,
                    )
                    .is_empty()
                {
                    scope_files.insert(rel.clone());
                }
            }
        }
    }
    let target_usage_found = !target_symbols.is_empty() && scope_files.len() > 1;

    if scope_files.is_empty() {
        return handle_pre_plan_discovery(
            arguments,
            idx,
            &root_str,
            py_layer,
            rust_layer,
            go_layer,
            java_layer,
        );
    }

    let mut file_deps: HashMap<String, HashSet<String>> = structure
        .module_dependencies
        .iter()
        .filter(|(file, _)| scope_files.contains(*file))
        .map(|(file, dependencies)| {
            (
                file.clone(),
                dependencies
                    .iter()
                    .filter(|dependency| scope_files.contains(*dependency))
                    .cloned()
                    .collect(),
            )
        })
        .collect();
    for (file, dependencies) in &py_structure.module_dependencies {
        if !scope_files.contains(file) {
            continue;
        }
        file_deps.entry(file.clone()).or_default().extend(
            dependencies
                .iter()
                .filter(|dependency| scope_files.contains(*dependency))
                .cloned(),
        );
    }
    for (file, dependencies) in &rust_structure.module_dependencies {
        if !scope_files.contains(file) { continue; }
        file_deps.entry(file.clone()).or_default().extend(
            dependencies.iter().filter(|dependency| scope_files.contains(*dependency)).cloned(),
        );
    }
    for (file, dependencies) in &go_structure.module_dependencies {
        if !scope_files.contains(file) {
            continue;
        }
        file_deps.entry(file.clone()).or_default().extend(
            dependencies
                .iter()
                .filter(|dependency| scope_files.contains(*dependency))
                .cloned(),
        );
    }
    for (file, dependencies) in &java_structure.module_dependencies {
        if !scope_files.contains(file) { continue; }
        file_deps.entry(file.clone()).or_default().extend(
            dependencies.iter().filter(|dependency| scope_files.contains(*dependency)).cloned(),
        );
    }
    for file in &scope_files {
        file_deps.entry(file.clone()).or_default();
    }

    let mut all_defs: HashMap<String, Vec<String>> = HashMap::new();
    for entry in idx.files().filter(|entry| {
        !matches!(entry.lang, language::Lang::TypeScript | language::Lang::Tsx | language::Lang::Python | language::Lang::Rust | language::Lang::Go | language::Lang::Java)
    }) {
        let rel = make_relative(&entry.path.to_string_lossy(), &root_str);
        for definition in
            symbols::extract_definitions(&entry.tree, &entry.source, &entry.path, entry.lang)
        {
            let files = all_defs.entry(definition.name).or_default();
            if !files.contains(&rel) {
                files.push(rel.clone());
            }
        }
    }

    for entry in idx.files() {
        let rel = make_relative(&entry.path.to_string_lossy(), &root_str);
        if !scope_files.contains(&rel) {
            continue;
        }
        if matches!(entry.lang, language::Lang::TypeScript | language::Lang::Tsx | language::Lang::Python | language::Lang::Rust | language::Lang::Go | language::Lang::Java) {
            continue;
        }
        let defs = symbols::extract_definitions(&entry.tree, &entry.source, &entry.path, entry.lang);
        for d in &defs {
            let callees = symbols::extract_callees(&entry.tree, &entry.source, &entry.path, &d.name, entry.lang);
            for callee in &callees {
                if let Some(def_files) = all_defs.get(&callee.name) {
                    if def_files.len() == 1 {
                        let def_file = &def_files[0];
                        if def_file != &rel && scope_files.contains(def_file) {
                            file_deps.get_mut(&rel).map(|deps| deps.insert(def_file.clone()));
                        }
                    }
                }
            }
        }
    }

    let (edit_order, dependency_cycle_files) = topological_sort(&file_deps);
    let mut candidate_order = edit_order.clone();
    candidate_order.extend(dependency_cycle_files.iter().cloned());
    let related_tests = find_related_tests(&scope_files, &HashSet::new(), idx);

    let steps: Vec<Value> = edit_order
        .iter()
        .enumerate()
        .map(|(i, file)| {
            let mut deps: Vec<&String> = file_deps
                .get(file)
                .map(|s| s.iter().collect())
                .unwrap_or_default();
        deps.sort();
        json!({
            "order": i + 1,
            "file": file,
            "depends_on": deps,
        })
        })
        .collect();

    let task = arguments.get("task").and_then(|s| s.as_str()).unwrap_or("");
    let parse_errors = parse_errors_for_paths(idx, &scope_files, &root_str);
    let confidence = if !outside_workspace_files.is_empty() {
        "medium"
    } else if !parse_errors.is_empty()
        || !unresolved_module_specifiers.is_empty()
        || !ambiguous_symbols.is_empty()
        || unresolved_external_modules
        || !blocked_module_specifiers.is_empty()
        || !dynamic_import_files.is_empty()
        || module_graph_cycle
        || module_graph_truncated
        || !dependency_cycle_files.is_empty()
        || index_consistency == "bounded_stale"
        || (!ts_target_files.is_empty() && !structure_verified)
        || (!py_structure_files.is_empty() && !py_structure_verified)
        || (!rust_structure_files.is_empty() && !rust_structure_verified)
        || (!go_structure_files.is_empty() && !go_structure_verified)
        || (!java_structure_files.is_empty() && !java_structure_verified)
    {
        "medium"
    } else if target_symbols.is_empty()
        || (target_definition_found && target_usage_found)
    {
        "high"
    } else {
        "medium"
    };
    let mut missing_evidence = Vec::new();
    if !target_symbols.is_empty() && !target_definition_found {
        missing_evidence.push("target_symbol_definition");
    }
    if !target_symbols.is_empty() && !target_usage_found {
        missing_evidence.push("cross_file_symbol_usage");
    }
    if !parse_errors.is_empty() {
        missing_evidence.push("parse_errors");
    }
    if !unresolved_module_specifiers.is_empty() {
        missing_evidence.push("module_resolution");
    }
    if unresolved_external_modules {
        missing_evidence.push("external_module_resolution");
    }
    if !blocked_module_specifiers.is_empty() {
        missing_evidence.push("blocked_module_path");
    }
    if !dynamic_import_files.is_empty() {
        missing_evidence.push("dynamic_imports");
    }
    if module_graph_cycle {
        missing_evidence.push("module_graph_cycle");
    }
    if module_graph_truncated {
        missing_evidence.push("module_graph_truncated");
    }
    if !ambiguous_symbols.is_empty() {
        missing_evidence.push("ambiguous_definitions");
    }
    if !dependency_cycle_files.is_empty() {
        missing_evidence.push("dependency_cycle");
    }
    if index_consistency == "bounded_stale" {
        missing_evidence.push("index_snapshot_staleness");
    }
    if !ts_target_files.is_empty() && !structure_verified {
        missing_evidence.push("typescript_program");
    }
    if !py_structure_files.is_empty() && !py_structure_verified {
        missing_evidence.push("pyright_program");
    }
    if !rust_structure_files.is_empty() && !rust_structure_verified {
        missing_evidence.push("rust_analyzer_program");
    }
    if !go_structure_files.is_empty() && !go_structure_verified {
        missing_evidence.push("gopls_program");
    }
    if !java_structure_files.is_empty() && !java_structure_verified {
        missing_evidence.push("jdtls_program");
    }
    if !outside_workspace_files.is_empty() {
        missing_evidence.push("outside_workspace");
    }
    let mut suggested_minimal_reads: Vec<Value> = candidate_order
        .iter()
        .map(|file| read_hint(file.clone(), 1, "planned edit file"))
        .collect();
    for test in related_tests.iter().take(6) {
        push_read_hint_unique(
            &mut suggested_minimal_reads,
            test.clone(),
            1,
            "related test",
        );
    }
    let mut result = json!({
        "task": task,
        "edit_order": steps,
        "total_files": scope_files.len(),
        "parse_errors": parse_errors,
        "unresolved_module_specifiers": unresolved_module_specifiers,
        "external_module_specifiers": external_module_specifiers,
        "blocked_module_specifiers": blocked_module_specifiers,
        "dynamic_import_files": dynamic_import_files,
        "module_graph_cycle": module_graph_cycle,
        "module_graph_truncated": module_graph_truncated,
        "dependency_cycle_files": dependency_cycle_files,
        "ambiguous_symbols": ambiguous_symbols,
        "related_tests": related_tests,
        "index_consistency": index_consistency,
        "max_staleness_ms": index::MAX_STALENESS_MS,
        "semantic_engine": "language_semantic_programs",
        "semantic_engine_status": structure.status,
        "semantic_engine_reason": structure.reason,
        "semantic_snapshot_id": structure.snapshot_id,
        "program_build_count": structure.program_build_count,
        "program_rebuilt": structure.program_rebuilt,
        "semantic_elapsed_ms": structure.elapsed_ms,
        "python_semantic_engine_status": py_structure.status,
        "python_semantic_engine_reason": py_structure.reason,
        "python_semantic_snapshot_id": py_structure.snapshot_id,
        "python_program_build_count": py_structure.program_build_count,
        "python_program_rebuilt": py_structure.program_rebuilt,
        "python_semantic_elapsed_ms": py_structure.elapsed_ms,
        "rust_semantic_engine_status": rust_structure.status,
        "rust_semantic_engine_reason": rust_structure.reason,
        "rust_semantic_snapshot_id": rust_structure.snapshot_id,
        "rust_program_build_count": rust_structure.program_build_count,
        "rust_program_rebuilt": rust_structure.program_rebuilt,
        "rust_semantic_elapsed_ms": rust_structure.elapsed_ms,
        "java_semantic_engine_status": java_structure.status,
        "java_semantic_engine_reason": java_structure.reason,
        "java_semantic_snapshot_id": java_structure.snapshot_id,
        "java_program_build_count": java_structure.program_build_count,
        "java_program_rebuilt": java_structure.program_rebuilt,
        "java_semantic_elapsed_ms": java_structure.elapsed_ms,
        "answer_pack": build_answer_pack(
            "plan",
            confidence,
            target_symbols.iter().take(8).map(|name| json!({ "name": name })).collect(),
            Vec::new(),
            candidate_order,
            related_tests,
            vec![
                "file edit order",
                "cross-file dependency order",
                "related tests",
            ],
            suggested_minimal_reads,
            missing_evidence,
        ),
    });
    result["go_semantic_engine_status"] = json!(go_structure.status);
    result["go_semantic_engine_reason"] = json!(go_structure.reason);
    result["go_semantic_snapshot_id"] = json!(go_structure.snapshot_id);
    result["go_program_build_count"] = json!(go_structure.program_build_count);
    result["go_program_rebuilt"] = json!(go_structure.program_rebuilt);
    result["go_semantic_elapsed_ms"] = json!(go_structure.elapsed_ms);
    result["outside_workspace_files"] = json!(outside_workspace_files);
    result["not_covered_files"] = json!(outside_workspace_files);

    tool_success("pre_plan", result)
}

fn handle_pre_plan_discovery(
    arguments: &Value,
    idx: &Index,
    root_str: &str,
    py_layer: &mut Option<py_deep_layer::PyDeepLayer>,
    rust_layer: &mut Option<rust_deep_layer::RustDeepLayer>,
    go_layer: &mut Option<go_deep_layer::GoDeepLayer>,
    java_layer: &mut Option<java_deep_layer::JavaDeepLayer>,
) -> Value {
    let task = arguments.get("task").and_then(|s| s.as_str()).unwrap_or("");
    let task_terms = tokenize_identifier(task);
    let mut candidates: HashMap<String, PlanCandidate> = HashMap::new();
    let has_ts_files = idx
        .files()
        .any(|entry| matches!(entry.lang, language::Lang::TypeScript | language::Lang::Tsx));
    let has_python_files = idx.files().any(|entry| entry.lang == language::Lang::Python);
    let has_rust_files = idx.files().any(|entry| entry.lang == language::Lang::Rust);
    let has_go_files = idx.files().any(|entry| entry.lang == language::Lang::Go);
    let has_java_files = idx.files().any(|entry| entry.lang == language::Lang::Java);
    let mut discovery_terms: Vec<String> = task_terms.iter().cloned().collect();
    discovery_terms.sort();
    let mut py_discovery = if has_python_files {
        py_deep_layer::run_discovery(py_layer, &idx.root, &discovery_terms)
    } else {
        py_deep_layer::PyDiscoveryResult {
            candidates: vec![],
            status: "disabled",
            reason: Some("no Python files selected".to_string()),
            program_build_count: 0,
            program_rebuilt: false,
            snapshot_id: "0".to_string(),
            elapsed_ms: 0,
        }
    };
    let mut rust_discovery = if has_rust_files {
        rust_deep_layer::run_discovery(rust_layer, &idx.root, &discovery_terms)
    } else {
        rust_deep_layer::RustDiscoveryResult {
            candidates: vec![],
            status: "disabled",
            reason: Some("no Rust files selected".to_string()),
            program_build_count: 0,
            program_rebuilt: false,
            snapshot_id: "0".to_string(),
            elapsed_ms: 0,
        }
    };
    let mut go_discovery = if has_go_files {
        go_deep_layer::run_discovery(go_layer, &idx.root, &discovery_terms)
    } else {
        go_deep_layer::GoDiscoveryResult {
            candidates: vec![],
            status: "disabled",
            reason: Some("no Go files selected".to_string()),
            program_build_count: 0,
            program_rebuilt: false,
            snapshot_id: "0".to_string(),
            elapsed_ms: 0,
        }
    };
    let mut java_discovery = if has_java_files {
        java_deep_layer::run_discovery(java_layer, &idx.root, &discovery_terms)
    } else {
        java_deep_layer::JavaDiscoveryResult {
            candidates: vec![], status: "disabled", reason: Some("no Java files selected".to_string()),
            program_build_count: 0, program_rebuilt: false, snapshot_id: "0".to_string(), elapsed_ms: 0,
        }
    };
    if has_python_files {
        let files: Vec<String> = idx
            .files()
            .filter(|entry| entry.lang == language::Lang::Python)
            .map(|entry| make_relative(&entry.path.to_string_lossy(), root_str))
            .collect();
        let input_snapshot_id = scoped_snapshot_id(
            &idx.root,
            &idx.root,
            &files,
            &["pyrightconfig.json", "pyproject.toml"],
            &py_discovery.snapshot_id,
        );
        py_discovery.snapshot_id = semantic_snapshot_id(
            &input_snapshot_id,
            &json!({
                "candidates": &py_discovery.candidates,
                "status": py_discovery.status,
                "reason": &py_discovery.reason,
            }),
        );
    }
    if has_rust_files {
        let files: Vec<String> = idx
            .files()
            .filter(|entry| entry.lang == language::Lang::Rust)
            .map(|entry| make_relative(&entry.path.to_string_lossy(), root_str))
            .collect();
        let input_snapshot_id = scoped_snapshot_id(
            &idx.root,
            &idx.root,
            &files,
            &["Cargo.toml", "rust-project.json"],
            &rust_discovery.snapshot_id,
        );
        rust_discovery.snapshot_id = semantic_snapshot_id(
            &input_snapshot_id,
            &json!({
                "candidates": &rust_discovery.candidates,
                "status": rust_discovery.status,
                "reason": &rust_discovery.reason,
            }),
        );
    }
    if has_go_files {
        let files: Vec<String> = idx
            .files()
            .filter(|entry| entry.lang == language::Lang::Go)
            .map(|entry| make_relative(&entry.path.to_string_lossy(), root_str))
            .collect();
        let input_snapshot_id = scoped_snapshot_id(
            &idx.root,
            &idx.root,
            &files,
            &["go.mod", "go.work"],
            &go_discovery.snapshot_id,
        );
        go_discovery.snapshot_id = semantic_snapshot_id(
            &input_snapshot_id,
            &json!({
                "candidates": &go_discovery.candidates,
                "status": go_discovery.status,
                "reason": &go_discovery.reason,
            }),
        );
    }
    if has_java_files {
        let files: Vec<String> = idx
            .files()
            .filter(|entry| entry.lang == language::Lang::Java)
            .map(|entry| make_relative(&entry.path.to_string_lossy(), root_str))
            .collect();
        let input_snapshot_id = scoped_snapshot_id(
            &idx.root,
            &idx.root,
            &files,
            &["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"],
            &java_discovery.snapshot_id,
        );
        java_discovery.snapshot_id = semantic_snapshot_id(
            &input_snapshot_id,
            &json!({
                "candidates": &java_discovery.candidates,
                "status": java_discovery.status,
                "reason": &java_discovery.reason,
            }),
        );
    }
    for candidate in &py_discovery.candidates {
        let Some(name) = candidate.get("name").and_then(Value::as_str) else {
            continue;
        };
        let Some(file) = candidate.get("file").and_then(Value::as_str) else {
            continue;
        };
        let line = candidate.get("line").and_then(Value::as_u64).unwrap_or(1) as usize;
        if !is_discovery_anchor_candidate(name, file) {
            continue;
        }
        candidates.insert(
            format!("Python:{file}:{line}:{name}"),
            PlanCandidate::new(
                name.to_string(),
                file.to_string(),
                line,
                "PythonSymbol".to_string(),
                relevance_score(task, &task_terms, name, file),
            ),
        );
    }
    for candidate in &rust_discovery.candidates {
        let Some(name) = candidate.get("name").and_then(Value::as_str) else {
            continue;
        };
        let Some(file) = candidate.get("file").and_then(Value::as_str) else {
            continue;
        };
        let line = candidate.get("line").and_then(Value::as_u64).unwrap_or(1) as usize;
        if !is_discovery_anchor_candidate(name, file) {
            continue;
        }
        candidates.insert(
            format!("Rust:{file}:{line}:{name}"),
            PlanCandidate::new(
                name.to_string(),
                file.to_string(),
                line,
                "RustSymbol".to_string(),
                relevance_score(task, &task_terms, name, file),
            ),
        );
    }
    for candidate in &go_discovery.candidates {
        let Some(name) = candidate.get("name").and_then(Value::as_str) else {
            continue;
        };
        let Some(file) = candidate.get("file").and_then(Value::as_str) else {
            continue;
        };
        let line = candidate.get("line").and_then(Value::as_u64).unwrap_or(1) as usize;
        if !is_discovery_anchor_candidate(name, file) {
            continue;
        }
        candidates.insert(
            format!("Go:{file}:{line}:{name}"),
            PlanCandidate::new(
                name.to_string(),
                file.to_string(),
                line,
                "GoSymbol".to_string(),
                relevance_score(task, &task_terms, name, file),
            ),
        );
    }
    for candidate in &java_discovery.candidates {
        let Some(name) = candidate.get("name").and_then(Value::as_str) else { continue; };
        let Some(file) = candidate.get("file").and_then(Value::as_str) else { continue; };
        let line = candidate.get("line").and_then(Value::as_u64).unwrap_or(1) as usize;
        if !is_discovery_anchor_candidate(name, file) { continue; }
        candidates.insert(
            format!("Java:{file}:{line}:{name}"),
            PlanCandidate::new(name.to_string(), file.to_string(), line, "JavaSymbol".to_string(),
                relevance_score(task, &task_terms, name, file)),
        );
    }
    let file_entries: Vec<_> = idx
        .files()
        .filter(|entry| {
            !matches!(entry.lang, language::Lang::TypeScript | language::Lang::Tsx | language::Lang::Python | language::Lang::Rust | language::Lang::Go | language::Lang::Java)
        })
        .collect();

    for entry in &file_entries {
        let rel = make_relative(&entry.path.to_string_lossy(), root_str);
        for d in symbols::extract_definitions(&entry.tree, &entry.source, &entry.path, entry.lang) {
            if !is_discovery_anchor_candidate(&d.name, &rel) {
                continue;
            }
            candidates.entry(d.name.clone()).or_insert_with(|| {
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
            let callees = symbols::extract_callees(
                &entry.tree,
                &entry.source,
                &entry.path,
                &d.name,
                entry.lang,
            );
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
            .then_with(|| b.score().cmp(&a.score()))
            .then_with(|| a.file.cmp(&b.file))
            .then_with(|| a.name.cmp(&b.name))
    });
    ranked.truncate(8);

    let anchor_symbols: Vec<Value> = ranked
        .iter()
        .map(|c| {
            json!({
            "name": &c.name,
            "file": &c.file,
            "line": c.line,
            "kind": &c.kind,
            "score": c.score(),
            "relevance": c.relevance,
            "caller_count": c.caller_count,
            "callee_count": c.callee_count,
            })
        })
        .collect();

    let mut candidate_files: Vec<String> = ranked.iter().map(|c| c.file.clone()).collect();
    candidate_files.sort();
    candidate_files.dedup();

    let suggested_calls: Vec<Value> = ranked
        .iter()
        .take(4)
        .map(|c| {
            json!({
            "tool": "pre_context",
            "arguments": {
                "symbol": &c.name,
                "path": &c.file,
                "depth": 2
            },
            "reason": "semantic discovery anchor",
            })
        })
        .collect();

    let candidate_file_set: HashSet<String> = candidate_files.iter().cloned().collect();
    let related_tests = find_related_tests(&candidate_file_set, &HashSet::new(), idx);
    let parse_errors = parse_errors_for_paths(idx, &candidate_file_set, root_str);
    let mut suggested_minimal_reads: Vec<Value> = ranked
        .iter()
        .take(8)
        .map(|c| read_hint(c.file.clone(), c.line, "candidate anchor"))
        .collect();
    for test in related_tests.iter().take(6) {
        push_read_hint_unique(
            &mut suggested_minimal_reads,
            test.clone(),
            1,
            "related test",
        );
    }
    let mut missing_evidence = if ranked.is_empty() {
        vec!["anchor_symbols"]
    } else {
        Vec::new()
    };
    if !parse_errors.is_empty() {
        missing_evidence.push("parse_errors");
    }
    if has_ts_files {
        missing_evidence.push("typescript_discovery_requires_targets");
    }
    if has_python_files && py_discovery.status != "verified" {
        missing_evidence.push("pyright_program");
    }
    if has_rust_files && rust_discovery.status != "verified" {
        missing_evidence.push("rust_analyzer_program");
    }
    if has_go_files && go_discovery.status != "verified" {
        missing_evidence.push("gopls_program");
    }
    if has_java_files && java_discovery.status != "verified" {
        missing_evidence.push("jdtls_program");
    }
    let confidence = if ranked.is_empty() {
        "low"
    } else if !parse_errors.is_empty()
        || (has_python_files && py_discovery.status != "verified")
        || (has_rust_files && rust_discovery.status != "verified")
        || (has_go_files && go_discovery.status != "verified")
        || (has_java_files && java_discovery.status != "verified")
    {
        "medium"
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
        "parse_errors": parse_errors,
        "suggested_calls": suggested_calls,
        "related_tests": related_tests,
        "python_semantic_engine_status": py_discovery.status,
        "python_semantic_engine_reason": py_discovery.reason,
        "python_semantic_snapshot_id": py_discovery.snapshot_id,
        "python_program_build_count": py_discovery.program_build_count,
        "python_program_rebuilt": py_discovery.program_rebuilt,
        "python_semantic_elapsed_ms": py_discovery.elapsed_ms,
        "rust_semantic_engine_status": rust_discovery.status,
        "rust_semantic_engine_reason": rust_discovery.reason,
        "rust_semantic_snapshot_id": rust_discovery.snapshot_id,
        "rust_program_build_count": rust_discovery.program_build_count,
        "rust_program_rebuilt": rust_discovery.program_rebuilt,
        "rust_semantic_elapsed_ms": rust_discovery.elapsed_ms,
        "go_semantic_engine_status": go_discovery.status,
        "go_semantic_engine_reason": go_discovery.reason,
        "go_semantic_snapshot_id": go_discovery.snapshot_id,
        "go_program_build_count": go_discovery.program_build_count,
        "go_program_rebuilt": go_discovery.program_rebuilt,
        "go_semantic_elapsed_ms": go_discovery.elapsed_ms,
        "java_semantic_engine_status": java_discovery.status,
        "java_semantic_engine_reason": java_discovery.reason,
        "java_semantic_snapshot_id": java_discovery.snapshot_id,
        "java_program_build_count": java_discovery.program_build_count,
        "java_program_rebuilt": java_discovery.program_rebuilt,
        "java_semantic_elapsed_ms": java_discovery.elapsed_ms,
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

    tool_success("pre_plan", result)
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

fn topological_sort(deps: &HashMap<String, HashSet<String>>) -> (Vec<String>, Vec<String>) {
    let mut in_degree: HashMap<String, usize> = HashMap::new();
    let mut dependents: HashMap<String, Vec<String>> = HashMap::new();
    for key in deps.keys() {
        in_degree.entry(key.clone()).or_insert(0);
        dependents.entry(key.clone()).or_default();
    }
    for (node, edges) in deps {
        for dep in edges {
            if deps.contains_key(dep) {
                dependents.entry(dep.clone()).or_default().push(node.clone());
            }
        }
        *in_degree.entry(node.clone()).or_insert(0) =
            edges.iter().filter(|dependency| deps.contains_key(*dependency)).count();
    }
    for nodes in dependents.values_mut() {
        nodes.sort();
        nodes.dedup();
    }

    let mut queue: BTreeSet<String> = in_degree
        .iter()
        .filter(|(_, &deg)| deg == 0)
        .map(|(key, _)| key.clone())
        .collect();
    let mut sorted: Vec<String> = Vec::new();

    while let Some(node) = queue.pop_first() {
        sorted.push(node.clone());
        if let Some(deps_of_node) = dependents.get(&node) {
            for dependent in deps_of_node {
                if let Some(count) = in_degree.get_mut(dependent) {
                    *count = count.saturating_sub(1);
                    if *count == 0 {
                        queue.insert(dependent.clone());
                    }
                }
            }
        }
    }

    let sorted_set: HashSet<&String> = sorted.iter().collect();
    let mut cycle_files: Vec<String> = deps
        .keys()
        .filter(|key| !sorted_set.contains(*key))
        .cloned()
        .collect();
    cycle_files.sort();
    (sorted, cycle_files)
}

struct VerificationLayerResult<'a> {
    language: &'a str,
    files: &'a [String],
    status: &'a str,
    reason: Option<&'a str>,
    verification: Option<&'a Value>,
}

fn group_changed_files_by_language(
    changed_files: &[String],
) -> HashMap<&'static str, Vec<String>> {
    let mut grouped = HashMap::new();
    for file in changed_files {
        if let Some(capability) = language::capability_for_path(file) {
            if !capability_supports_tool(capability, "pre_verify") {
                continue;
            }
            grouped
                .entry(capability.language)
                .or_insert_with(Vec::new)
                .push(file.clone());
        }
    }
    grouped
}

fn files_for_language(
    grouped: &HashMap<&'static str, Vec<String>>,
    language: &str,
) -> Vec<String> {
    grouped.get(language).cloned().unwrap_or_default()
}

struct ConfigScope {
    root: PathBuf,
    workspace_files: Vec<String>,
    helper_files: Vec<String>,
}

struct ScopedLanguageResult {
    scope: String,
    files: Vec<String>,
    status: &'static str,
    reason: Option<String>,
    verification: Value,
    program_build_count: u64,
    program_rebuilt: bool,
    snapshot_id: String,
    elapsed_ms: u128,
}

struct AggregatedLanguageResult {
    status: &'static str,
    reason: Option<String>,
    verification: Value,
    program_build_count: u64,
    program_rebuilt: bool,
    snapshot_id: String,
    elapsed_ms: u128,
}

fn nearest_config_root(workspace_root: &Path, file: &str, markers: &[&str]) -> PathBuf {
    let absolute = workspace_root.join(file);
    let mut current = absolute.parent();
    while let Some(directory) = current {
        if !directory.starts_with(workspace_root) {
            break;
        }
        if markers.iter().any(|marker| directory.join(marker).is_file()) {
            return directory.to_path_buf();
        }
        if directory == workspace_root {
            break;
        }
        current = directory.parent();
    }
    workspace_root.to_path_buf()
}

fn group_files_by_config_root(
    workspace_root: &Path,
    files: &[String],
    markers: &[&str],
) -> Vec<ConfigScope> {
    let mut grouped: BTreeMap<PathBuf, Vec<String>> = BTreeMap::new();
    for file in files {
        grouped
            .entry(nearest_config_root(workspace_root, file, markers))
            .or_default()
            .push(file.clone());
    }
    grouped
        .into_iter()
        .map(|(root, mut workspace_files)| {
            workspace_files.sort();
            let helper_files = workspace_files
                .iter()
                .map(|file| {
                    workspace_root
                        .join(file)
                        .strip_prefix(&root)
                        .unwrap_or_else(|_| Path::new(file))
                        .to_string_lossy()
                        .replace('\\', "/")
                })
                .collect();
            ConfigScope {
                root,
                workspace_files,
                helper_files,
            }
        })
        .collect()
}

fn config_scope_name(workspace_root: &Path, scope_root: &Path) -> String {
    scope_root
        .strip_prefix(workspace_root)
        .unwrap_or(scope_root)
        .to_string_lossy()
        .replace('\\', "/")
        .trim_matches('/')
        .to_string()
}

fn scoped_snapshot_id(
    workspace_root: &Path,
    scope_root: &Path,
    files: &[String],
    markers: &[&str],
    _helper_snapshot_id: &str,
) -> String {
    let canonical_root = workspace_root.canonicalize().ok();
    let scope = config_scope_name(workspace_root, scope_root);
    let mut entries: Vec<(String, PathBuf)> = files
        .iter()
        .filter_map(|file| {
            let workspace_file = scoped_path(&scope, file)?;
            Some((format!("file:{workspace_file}"), workspace_root.join(workspace_file)))
        })
        .collect();
    entries.extend(markers.iter().map(|marker| {
        (
            format!("config:{scope}/{marker}"),
            scope_root.join(marker),
        )
    }));
    entries.sort_by(|left, right| left.0.cmp(&right.0));
    entries.dedup_by(|left, right| left.0 == right.0);

    let mut hash = 0xcbf29ce484222325_u64;
    update_deterministic_hash(&mut hash, scope.as_bytes());
    for (name, path) in entries {
        update_deterministic_hash(&mut hash, name.as_bytes());
        let resolved = path.canonicalize().ok();
        let is_bounded = match (&canonical_root, &resolved) {
            (Some(root), Some(candidate)) => candidate.starts_with(root),
            _ => false,
        };
        if is_bounded {
            match std::fs::read(path) {
                Ok(content) => update_deterministic_hash(&mut hash, &content),
                Err(_) => update_deterministic_hash(&mut hash, b"unreadable"),
            }
        } else if path.exists() {
            update_deterministic_hash(&mut hash, b"outside_workspace");
        } else {
            update_deterministic_hash(&mut hash, b"missing");
        }
    }
    format!("{hash:016x}")
}

fn update_deterministic_hash(hash: &mut u64, bytes: &[u8]) {
    *hash ^= bytes.len() as u64;
    *hash = hash.wrapping_mul(0x100000001b3);
    for byte in bytes {
        *hash ^= u64::from(*byte);
        *hash = hash.wrapping_mul(0x100000001b3);
    }
}

fn canonical_value(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => serde_json::to_string(value).unwrap_or_default(),
        Value::Array(values) => {
            let mut values: Vec<String> = values.iter().map(canonical_value).collect();
            values.sort();
            format!("[{}]", values.join(","))
        }
        Value::Object(values) => {
            let mut values: Vec<String> = values
                .iter()
                .map(|(key, value)| format!("{}:{}", serde_json::to_string(key).unwrap_or_default(), canonical_value(value)))
                .collect();
            values.sort();
            format!("{{{}}}", values.join(","))
        }
    }
}

fn semantic_snapshot_id(input_snapshot_id: &str, value: &Value) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    update_deterministic_hash(&mut hash, input_snapshot_id.as_bytes());
    update_deterministic_hash(&mut hash, canonical_value(value).as_bytes());
    format!("{hash:016x}")
}

fn structure_snapshot_id(
    input_snapshot_id: &str,
    result: &ts_deep_layer::StructureResult,
) -> String {
    let relations: Vec<Value> = result
        .relations
        .iter()
        .map(|(symbol, relations)| {
            json!({
                "symbol": symbol,
                "targets": relations.targets.iter().map(|target| json!({
                    "file": target.file, "name": target.name,
                    "line": target.line, "character": target.character,
                    "end_line": target.end_line, "end_character": target.end_character,
                })).collect::<Vec<_>>(),
                "names_by_file": relations.names_by_file,
                "related_files": relations.related_files,
                "references": relations.references.iter().map(|location| json!({
                    "file": location.file, "name": location.name,
                    "line": location.line, "character": location.character,
                    "end_line": location.end_line, "end_character": location.end_character,
                })).collect::<Vec<_>>(),
                "callers": relations.callers.iter().map(|location| json!({
                    "file": location.file, "name": location.name,
                    "line": location.line, "character": location.character,
                    "end_line": location.end_line, "end_character": location.end_character,
                })).collect::<Vec<_>>(),
                "callees": relations.callees.iter().map(|location| json!({
                    "file": location.file, "name": location.name,
                    "line": location.line, "character": location.character,
                    "end_line": location.end_line, "end_character": location.end_character,
                })).collect::<Vec<_>>(),
                "unresolved_module_specifiers": relations.unresolved_module_specifiers,
                "unresolved_relative_specifiers": relations.unresolved_relative_specifiers,
                "external_module_specifiers": relations.external_module_specifiers,
                "blocked_module_specifiers": relations.blocked_module_specifiers,
                "dynamic_import_files": relations.dynamic_import_files,
                "graph_cycle": relations.graph_cycle,
                "graph_truncated": relations.graph_truncated,
            })
        })
        .collect();
    semantic_snapshot_id(
        input_snapshot_id,
        &json!({
            "relations": relations,
            "module_dependencies": result.module_dependencies,
            "status": result.status,
            "reason": result.reason,
        }),
    )
}

fn verification_snapshot_id(
    input_snapshot_id: &str,
    status: &str,
    reason: Option<&str>,
    issues: &[Value],
    verification: &Value,
    language_results: Option<&Value>,
) -> String {
    semantic_snapshot_id(
        input_snapshot_id,
        &json!({
            "status": status,
            "reason": reason,
            "issues": issues,
            "verification": verification,
            "language_results": language_results,
        }),
    )
}

fn rebase_scoped_issues(issues: &mut Vec<Value>, scope: &str) {
    issues.retain_mut(|issue| {
        let Some(file) = issue.get("file").and_then(Value::as_str) else {
            return true;
        };
        let Some(file) = scoped_path(scope, file) else {
            return false;
        };
        issue["file"] = json!(file);
        true
    });
}

fn scoped_path(scope: &str, path: &str) -> Option<String> {
    let raw_path = path.trim();
    if raw_path.is_empty() {
        return None;
    }
    let mut components: Vec<&str> = scope
        .split('/')
        .filter(|component| !component.is_empty() && *component != ".")
        .collect();
    let normalized = normalize_path(raw_path);
    let bytes = normalized.as_bytes();
    if normalized.starts_with('/')
        || raw_path.starts_with('\\')
        || (bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
    {
        return None;
    }
    for component in normalized.split('/') {
        match component {
            "" | "." => {}
            ".." => {
                components.pop()?;
            }
            value if value.contains(':') => return None,
            value => components.push(value),
        }
    }
    (!components.is_empty()).then(|| components.join("/"))
}

fn helper_path_from_workspace(scope: &str, path: &str) -> Option<String> {
    let normalized = normalize_path(path);
    let normalized_scope = normalize_path(scope);
    let scope_components: Vec<&str> = normalized_scope
        .trim_matches('/')
        .split('/')
        .filter(|component| !component.is_empty())
        .collect();
    if scope_components.is_empty() {
        return (!normalized.is_empty()).then_some(normalized);
    }
    let path_components: Vec<&str> = normalized
        .split('/')
        .filter(|component| !component.is_empty())
        .collect();
    let common = scope_components
        .iter()
        .zip(path_components.iter())
        .take_while(|(left, right)| left == right)
        .count();
    let mut relative = vec![".."; scope_components.len().saturating_sub(common)];
    relative.extend(path_components.into_iter().skip(common));
    (!relative.is_empty()).then(|| relative.join("/"))
}

fn refresh_scoped_helper_paths(
    idx: &mut Index,
    scope: &str,
    paths: &[String],
    outside_workspace_files: &mut Vec<String>,
) -> Vec<String> {
    let mut workspace_paths = Vec::new();
    for path in paths {
        if let Some(workspace_path) = scoped_path(scope, path) {
            workspace_paths.push(workspace_path);
        } else {
            outside_workspace_files.push(path.clone());
        }
    }
    let (accepted, rejected) = idx.refresh_paths(&workspace_paths);
    outside_workspace_files.extend(rejected);
    let mut helper_paths = Vec::new();
    for path in accepted {
        if let Some(helper_path) = helper_path_from_workspace(scope, &path) {
            helper_paths.push(helper_path);
        } else {
            outside_workspace_files.push(path);
        }
    }
    helper_paths.sort();
    helper_paths.dedup();
    helper_paths
}

fn retain_workspace_structure_paths(
    idx: &mut Index,
    result: &mut ts_deep_layer::StructureResult,
    outside_workspace_files: &mut Vec<String>,
) {
    let paths = collect_structure_paths(result);
    let (accepted, rejected) = idx.refresh_paths(&paths);
    let filtered = !rejected.is_empty();
    outside_workspace_files.extend(rejected);
    retain_structure_paths(result, accepted.into_iter().collect(), filtered);
}

fn retain_scoped_structure_paths(
    idx: &mut Index,
    scope: &str,
    result: &mut ts_deep_layer::StructureResult,
    outside_workspace_files: &mut Vec<String>,
) {
    let paths = collect_structure_paths(result);
    let outside_before = outside_workspace_files.len();
    let accepted = refresh_scoped_helper_paths(idx, scope, &paths, outside_workspace_files);
    retain_structure_paths(
        result,
        accepted.into_iter().collect(),
        outside_workspace_files.len() > outside_before,
    );
}

fn collect_structure_paths(result: &ts_deep_layer::StructureResult) -> Vec<String> {
    let mut paths = Vec::new();
    for (file, dependencies) in &result.module_dependencies {
        paths.push(file.clone());
        paths.extend(dependencies.iter().cloned());
    }
    for relations in result.relations.values() {
        paths.extend(relations.targets.iter().map(|target| target.file.clone()));
        paths.extend(relations.names_by_file.keys().cloned());
        paths.extend(relations.related_files.iter().cloned());
        paths.extend(relations.references.iter().map(|location| location.file.clone()));
        paths.extend(relations.callers.iter().map(|location| location.file.clone()));
        paths.extend(relations.callees.iter().map(|location| location.file.clone()));
        paths.extend(relations.dynamic_import_files.iter().cloned());
    }
    paths
}

fn retain_structure_paths(
    result: &mut ts_deep_layer::StructureResult,
    accepted: HashSet<String>,
    filtered: bool,
) {
    if filtered {
        for relations in result.relations.values_mut() {
            relations.graph_truncated = true;
        }
    }
    result.module_dependencies.retain(|file, dependencies| {
        dependencies.retain(|dependency| accepted.contains(dependency));
        accepted.contains(file)
    });
    for relations in result.relations.values_mut() {
        relations.targets.retain(|target| accepted.contains(&target.file));
        relations.names_by_file.retain(|file, _| accepted.contains(file));
        relations.related_files.retain(|file| accepted.contains(file));
        relations.references.retain(|location| accepted.contains(&location.file));
        relations.callers.retain(|location| accepted.contains(&location.file));
        relations.callees.retain(|location| accepted.contains(&location.file));
        relations.dynamic_import_files.retain(|file| accepted.contains(file));
    }
}

fn rebase_scoped_locations(
    locations: &mut Vec<ts_deep_layer::SemanticLocation>,
    scope: &str,
) {
    locations.retain_mut(|location| {
        let Some(file) = scoped_path(scope, &location.file) else {
            return false;
        };
        location.file = file;
        true
    });
}

fn rebase_structure_result(scope: &str, result: &mut ts_deep_layer::StructureResult) {
    result.module_dependencies = result
        .module_dependencies
        .drain()
        .filter_map(|(file, dependencies)| {
            Some((
                scoped_path(scope, &file)?,
                dependencies.into_iter().filter_map(|dependency| scoped_path(scope, &dependency)).collect(),
            ))
        })
        .collect();
    for relations in result.relations.values_mut() {
        relations.targets.retain_mut(|target| {
            let Some(file) = scoped_path(scope, &target.file) else {
                return false;
            };
            target.file = file;
            true
        });
        relations.names_by_file = relations
            .names_by_file
            .drain()
            .filter_map(|(file, names)| Some((scoped_path(scope, &file)?, names)))
            .collect();
        relations.related_files = relations
            .related_files
            .drain(..)
            .filter_map(|file| scoped_path(scope, &file))
            .collect();
        rebase_scoped_locations(&mut relations.references, scope);
        rebase_scoped_locations(&mut relations.callers, scope);
        rebase_scoped_locations(&mut relations.callees, scope);
        relations.dynamic_import_files = relations
            .dynamic_import_files
            .drain(..)
            .filter_map(|file| scoped_path(scope, &file))
            .collect();
    }
}

fn aggregate_scoped_structure_results(
    mut results: Vec<(String, ts_deep_layer::StructureResult)>,
) -> ts_deep_layer::StructureResult {
    results.sort_by(|left, right| left.0.cmp(&right.0));
    for (scope, result) in &mut results {
        rebase_structure_result(scope, result);
        let input_snapshot_id = result.snapshot_id.clone();
        result.snapshot_id = structure_snapshot_id(&input_snapshot_id, result);
    }
    if results.len() == 1 {
        return results.pop().expect("single scoped structure result").1;
    }

    let mut relations: HashMap<String, ts_deep_layer::SymbolRelations> = HashMap::new();
    let mut module_dependencies: HashMap<String, Vec<String>> = HashMap::new();
    let statuses: BTreeSet<&'static str> = results.iter().map(|(_, result)| result.status).collect();
    let status = if statuses.len() == 1 {
        results[0].1.status
    } else {
        "partially_verified"
    };
    let reason = results
        .iter()
        .filter_map(|(scope, result)| {
            result.reason.as_ref().map(|reason| {
                format!("scope={}: {reason}", if scope.is_empty() { "." } else { scope })
            })
        })
        .collect::<Vec<_>>();
    let snapshot_id = results
        .iter()
        .map(|(scope, result)| {
            format!("{}={}", if scope.is_empty() { "." } else { scope }, result.snapshot_id)
        })
        .collect::<Vec<_>>()
        .join("|");
    let program_build_count = results
        .iter()
        .map(|(_, result)| result.program_build_count)
        .sum();
    let program_rebuilt = results.iter().any(|(_, result)| result.program_rebuilt);
    let elapsed_ms = results.iter().map(|(_, result)| result.elapsed_ms).sum();

    for (_, result) in results {
        for (file, dependencies) in result.module_dependencies {
            module_dependencies.entry(file).or_default().extend(dependencies);
        }
        for (symbol, incoming) in result.relations {
            let current = relations.entry(symbol).or_default();
            current.targets.extend(incoming.targets);
            for (file, names) in incoming.names_by_file {
                current.names_by_file.entry(file).or_default().extend(names);
            }
            current.related_files.extend(incoming.related_files);
            current.references.extend(incoming.references);
            current.callers.extend(incoming.callers);
            current.callees.extend(incoming.callees);
            current
                .unresolved_module_specifiers
                .extend(incoming.unresolved_module_specifiers);
            current
                .unresolved_relative_specifiers
                .extend(incoming.unresolved_relative_specifiers);
            current
                .external_module_specifiers
                .extend(incoming.external_module_specifiers);
            current
                .blocked_module_specifiers
                .extend(incoming.blocked_module_specifiers);
            current.dynamic_import_files.extend(incoming.dynamic_import_files);
            current.graph_cycle |= incoming.graph_cycle;
            current.graph_truncated |= incoming.graph_truncated;
        }
    }
    for dependencies in module_dependencies.values_mut() {
        dependencies.sort();
        dependencies.dedup();
    }
    for current in relations.values_mut() {
        current.targets.sort_by(|left, right| {
            (&left.file, &left.name, left.line, left.character)
                .cmp(&(&right.file, &right.name, right.line, right.character))
        });
        current.targets.dedup_by(|left, right| {
            left.file == right.file
                && left.name == right.name
                && left.line == right.line
                && left.character == right.character
        });
        for names in current.names_by_file.values_mut() {
            names.sort();
            names.dedup();
        }
        current.related_files.sort();
        current.related_files.dedup();
        for locations in [&mut current.references, &mut current.callers, &mut current.callees] {
            locations.sort_by(|left, right| {
                (&left.file, &left.name, left.line, left.character)
                    .cmp(&(&right.file, &right.name, right.line, right.character))
            });
            locations.dedup_by(|left, right| {
                left.file == right.file
                    && left.name == right.name
                    && left.line == right.line
                    && left.character == right.character
            });
        }
        for values in [
            &mut current.unresolved_module_specifiers,
            &mut current.unresolved_relative_specifiers,
            &mut current.external_module_specifiers,
            &mut current.blocked_module_specifiers,
            &mut current.dynamic_import_files,
        ] {
            values.sort();
            values.dedup();
        }
    }

    ts_deep_layer::StructureResult {
        relations,
        module_dependencies,
        status,
        reason: (!reason.is_empty()).then(|| reason.join("; ")),
        program_build_count,
        program_rebuilt,
        snapshot_id: format!("scoped:{snapshot_id}"),
        elapsed_ms,
    }
}

fn aggregate_scoped_language_results(
    mut results: Vec<ScopedLanguageResult>,
) -> AggregatedLanguageResult {
    results.sort_by(|left, right| left.scope.cmp(&right.scope));
    let all_statuses: BTreeSet<&'static str> = results.iter().map(|result| result.status).collect();
    let status = if all_statuses.len() == 1 {
        results[0].status
    } else {
        "partially_verified"
    };
    let reason_parts: Vec<String> = results
        .iter()
        .filter_map(|result| {
            result.reason.as_ref().map(|reason| {
                let scope = if result.scope.is_empty() { "." } else { &result.scope };
                format!("scope={scope}: {reason}")
            })
        })
        .collect();
    let mut coverage: Option<BTreeSet<String>> = None;
    let mut missing = BTreeSet::new();
    let scopes: Vec<Value> = results
        .iter()
        .map(|result| {
            let scope_coverage: BTreeSet<String> = result
                .verification
                .get("coverage")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect();
            coverage = Some(match coverage.take() {
                Some(current) => current.intersection(&scope_coverage).cloned().collect(),
                None => scope_coverage,
            });
            if let Some(values) = result.verification.get("missing").and_then(Value::as_array) {
                missing.extend(values.iter().filter_map(Value::as_str).map(str::to_string));
            }
            json!({
                "root": if result.scope.is_empty() { "." } else { &result.scope },
                "files": result.files,
                "status": result.status,
                "reason": result.reason,
                "verification": result.verification,
                "semantic_snapshot_id": result.snapshot_id,
            })
        })
        .collect();
    let snapshot_id = if results.len() == 1 {
        results[0].snapshot_id.clone()
    } else {
        format!(
            "scoped:{}",
            results
                .iter()
                .map(|result| format!("{}={}", result.scope, result.snapshot_id))
                .collect::<Vec<_>>()
                .join("|")
        )
    };
    AggregatedLanguageResult {
        status,
        reason: (!reason_parts.is_empty()).then(|| reason_parts.join("; ")),
        verification: json!({
            "coverage": coverage.unwrap_or_default().into_iter().collect::<Vec<_>>(),
            "missing": missing.into_iter().collect::<Vec<_>>(),
            "scopes": scopes,
        }),
        program_build_count: results.iter().map(|result| result.program_build_count).sum(),
        program_rebuilt: results.iter().any(|result| result.program_rebuilt),
        snapshot_id,
        elapsed_ms: results.iter().map(|result| result.elapsed_ms).sum(),
    }
}

fn disabled_language_result(reason: &str, missing: &str) -> AggregatedLanguageResult {
    AggregatedLanguageResult {
        status: "disabled",
        reason: Some(reason.to_string()),
        verification: json!({ "coverage": [], "missing": [missing] }),
        program_build_count: 0,
        program_rebuilt: false,
        snapshot_id: "0".to_string(),
        elapsed_ms: 0,
    }
}

fn normalize_verification_layer_status(status: &str, reason: Option<&str>) -> &'static str {
    let status = status.to_ascii_lowercase();
    let reason = reason.unwrap_or_default().to_ascii_lowercase();

    if status.contains("fallback") || reason.contains("fallback") {
        return "fallback_used";
    }
    match status.as_str() {
        "active" | "verified" | "clean" | "type_error" => "verified",
        "partially_verified" | "error" => "partially_verified",
        "tool_missing" => "tool_missing",
        "unavailable" => {
            if reason.contains("_not_found")
                || reason.contains(" not found")
                || reason.contains("neither ")
            {
                "tool_missing"
            } else {
                "partially_verified"
            }
        }
        _ => "partially_verified",
    }
}

fn missing_external_tools(
    capability: &language::LanguageCapability,
    normalized_status: &str,
    reason: Option<&str>,
) -> Vec<&'static str> {
    if !matches!(normalized_status, "fallback_used" | "tool_missing") {
        return Vec::new();
    }

    let reason = reason.unwrap_or_default().to_ascii_lowercase();
    let explicit_missing = reason.contains("_not_found") || reason.contains("tool_missing");
    if normalized_status == "fallback_used" && !explicit_missing {
        return Vec::new();
    }
    let mut matched: Vec<&'static str> = capability
        .external_tools
        .iter()
        .copied()
        .filter(|tool| reason.contains(&tool.to_ascii_lowercase()))
        .collect();

    if matched.is_empty() && explicit_missing {
        matched.extend(capability.external_tools.iter().copied());
    }
    matched
}

fn build_verification_summary(
    changed_files: &[String],
    layers: &[VerificationLayerResult<'_>],
) -> Value {
    let mut covered_files = HashSet::new();
    let mut fully_verified_files = 0;
    let mut fallback_files = 0;
    let mut tool_missing_files = 0;
    let mut active_layers = 0;
    let mut fallback_layers = 0;
    let mut unavailable_layers = 0;
    let mut partial_layers = 0;
    let mut missing_tools = HashSet::new();
    let mut language_results = Vec::new();

    for layer in layers.iter().filter(|layer| !layer.files.is_empty()) {
        let Some(capability) = language::capability_for_name(layer.language) else {
            continue;
        };
        for file in layer.files {
            covered_files.insert(file.clone());
        }

        let normalized_status = normalize_verification_layer_status(layer.status, layer.reason);
        for tool in missing_external_tools(capability, normalized_status, layer.reason) {
            missing_tools.insert(tool.to_string());
        }
        let (status, checks_performed): (&str, Vec<&str>) = match normalized_status {
            "verified" => {
                active_layers += 1;
                fully_verified_files += layer.files.len();
                let checks = if capability.ast_indexed {
                    vec!["ast_structure", "configured_validator"]
                } else {
                    vec!["configured_validator"]
                };
                ("verified", checks)
            }
            "fallback_used" => {
                fallback_layers += 1;
                fallback_files += layer.files.len();
                ("fallback_used", vec![capability.fallback])
            }
            "tool_missing" => {
                unavailable_layers += 1;
                tool_missing_files += layer.files.len();
                let checks = if capability.ast_indexed {
                    vec!["ast_structure"]
                } else {
                    Vec::new()
                };
                ("tool_missing", checks)
            }
            _ => {
                partial_layers += 1;
                ("partially_verified", Vec::new())
            }
        };

        let fallback_missing: Vec<&str> = layer.reason.into_iter().collect();
        let verification = layer.verification.cloned().unwrap_or_else(|| json!({
            "validator_status": layer.status,
            "coverage": checks_performed,
            "missing": fallback_missing,
        }));
        let missing = verification
            .get("missing")
            .cloned()
            .unwrap_or_else(|| json!(fallback_missing));
        language_results.push(json!({
            "language": layer.language,
            "files": layer.files,
            "status": status,
            "validator_status": layer.status,
            "checks_performed": checks_performed,
            "reason": layer.reason,
            "missing": missing,
            "verification": verification,
            "capability": capability,
        }));
    }

    let not_covered_files: Vec<String> = changed_files
        .iter()
        .filter(|file| !covered_files.contains(*file))
        .cloned()
        .collect();
    if !not_covered_files.is_empty() {
        language_results.push(json!({
            "language": "unknown",
            "files": not_covered_files,
            "status": "not_covered",
            "checks_performed": [],
            "missing": ["no_registered_verifier"],
            "verification": {
                "coverage": [],
                "missing": ["no_registered_verifier"],
            },
        }));
    }

    let status = if covered_files.is_empty() {
        "not_covered"
    } else if !not_covered_files.is_empty() || partial_layers > 0 {
        "partially_verified"
    } else if active_layers > 0 && fallback_layers == 0 && unavailable_layers == 0 {
        "verified"
    } else if fallback_layers > 0 && active_layers == 0 && unavailable_layers == 0 {
        "fallback_used"
    } else if unavailable_layers > 0 && active_layers == 0 && fallback_layers == 0 {
        "tool_missing"
    } else {
        "partially_verified"
    };
    let mut missing_tools: Vec<String> = missing_tools.into_iter().collect();
    missing_tools.sort();

    json!({
        "status": status,
        "fully_verified": status == "verified",
        "requested_files": changed_files.len(),
        "covered_files": covered_files.len(),
        "fully_verified_files": fully_verified_files,
        "fallback_files": fallback_files,
        "tool_missing_files": tool_missing_files,
        "not_covered_files": not_covered_files,
        "missing_tools": missing_tools,
        "language_results": language_results,
    })
}

fn verification_result_status(has_issues: bool, verification: &Value) -> String {
    if has_issues {
        return "issues_found".to_string();
    }

    match verification
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("partially_verified")
    {
        "verified" => "pass".to_string(),
        status => status.to_string(),
    }
}

fn handle_pre_verify(
    arguments: &Value,
    index: &mut Option<Index>,
    deep_layer: &mut Option<ts_deep_layer::DeepLayer>,
    py_layer: &mut Option<py_deep_layer::PyDeepLayer>,
    rust_layer: &mut Option<rust_deep_layer::RustDeepLayer>,
    go_layer: &mut Option<go_deep_layer::GoDeepLayer>,
    java_layer: &mut Option<java_deep_layer::JavaDeepLayer>,
    sql_layer: &mut Option<sql_deep_layer::SqlDeepLayer>,
    shell_layer: &mut Option<shell_deep_layer::ShellDeepLayer>,
    csharp_layer: &mut Option<csharp_deep_layer::CsharpDeepLayer>,
    php_layer: &mut Option<php_deep_layer::PhpDeepLayer>,
    ruby_layer: &mut Option<ruby_deep_layer::RubyDeepLayer>,
    kotlin_layer: &mut Option<kotlin_deep_layer::KotlinDeepLayer>,
    dart_layer: &mut Option<dart_deep_layer::DartDeepLayer>,
    swift_layer: &mut Option<swift_deep_layer::SwiftDeepLayer>,
    cpp_layer: &mut Option<cpp_deep_layer::CppDeepLayer>,
) -> Value {
    let idx = match index.as_mut() {
        Some(i) => i,
        None => return tool_error("index not initialized — send initialize with rootUri first"),
    };
    let raw_changed_files: Vec<String> = arguments
        .get("changed_files")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| s.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    if raw_changed_files.is_empty() {
        return tool_error("changed_files array is required and must not be empty");
    }
    let t0 = std::time::Instant::now();
    let (changed_files, outside_workspace_files) = idx.refresh_paths(&raw_changed_files);
    let refresh_ms = t0.elapsed().as_millis();
    let root_str = idx.root.to_string_lossy().to_string();

    let t1 = std::time::Instant::now();

    let all_defs = idx.all_defs();

    let mut issues: Vec<Value> = Vec::new();

    for entry in idx.files() {
        let rel = make_relative(&entry.path.to_string_lossy(), &root_str);
        if !changed_files.contains(&rel) {
            continue;
        }
        if matches!(entry.lang, language::Lang::TypeScript | language::Lang::Tsx | language::Lang::Python | language::Lang::Rust | language::Lang::Go | language::Lang::Java) {
            continue;
        }
        let imported = symbols::extract_imports(&entry.tree, &entry.source, entry.lang);
        let local_bindings = symbols::extract_local_bindings(&entry.tree, &entry.source);
        let fn_callees = symbols::extract_all_callees_grouped(
            &entry.tree,
            &entry.source,
            &entry.path,
            entry.lang,
        );
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
    let grouped_files = group_changed_files_by_language(&changed_files);

    let typescript_files = files_for_language(&grouped_files, "TypeScript");
    let tsx_files = files_for_language(&grouped_files, "TSX");
    let typescript_and_tsx_files = typescript_files
        .iter()
        .chain(&tsx_files)
        .cloned()
        .collect::<Vec<_>>();
    let mut typescript_scope_results = Vec::new();
    let mut tsx_scope_results = Vec::new();
    for scope in group_files_by_config_root(&idx.root, &typescript_and_tsx_files, &["tsconfig.json"]) {
        let scope_name = config_scope_name(&idx.root, &scope.root);
        let mut result = ts_deep_layer::run(deep_layer, &scope.root, &scope.helper_files);
        result.snapshot_id = scoped_snapshot_id(
            &idx.root,
            &scope.root,
            &scope.helper_files,
            &["tsconfig.json"],
            &result.snapshot_id,
        );
        result.snapshot_id = verification_snapshot_id(
            &result.snapshot_id,
            result.status,
            result.reason.as_deref(),
            &result.issues,
            &result.verification,
            Some(&result.language_results),
        );
        rebase_scoped_issues(&mut result.issues, &scope_name);
        issues.append(&mut result.issues);
        let scope_typescript_files: Vec<String> = scope
            .workspace_files
            .iter()
            .filter(|file| language::capability_for_path(file).is_some_and(|value| value.language == "TypeScript"))
            .cloned()
            .collect();
        let scope_tsx_files: Vec<String> = scope
            .workspace_files
            .iter()
            .filter(|file| language::capability_for_path(file).is_some_and(|value| value.language == "TSX"))
            .cloned()
            .collect();
        if !scope_typescript_files.is_empty() {
            let (status, reason, verification) = ts_deep_layer::result_for_language(&result, "TypeScript");
            typescript_scope_results.push(ScopedLanguageResult {
                scope: scope_name.clone(),
                files: scope_typescript_files,
                status,
                reason,
                verification,
                program_build_count: result.program_build_count,
                program_rebuilt: result.program_rebuilt,
                snapshot_id: result.snapshot_id.clone(),
                elapsed_ms: result.elapsed_ms,
            });
        }
        if !scope_tsx_files.is_empty() {
            let (status, reason, verification) = ts_deep_layer::result_for_language(&result, "TSX");
            tsx_scope_results.push(ScopedLanguageResult {
                scope: scope_name,
                files: scope_tsx_files,
                status,
                reason,
                verification,
                program_build_count: result.program_build_count,
                program_rebuilt: result.program_rebuilt,
                snapshot_id: result.snapshot_id,
                elapsed_ms: result.elapsed_ms,
            });
        }
    }
    let typescript_result = if typescript_scope_results.is_empty() {
        disabled_language_result("no TypeScript files in changed_files", "no_typescript_files")
    } else {
        aggregate_scoped_language_results(typescript_scope_results)
    };
    let tsx_result = if tsx_scope_results.is_empty() {
        disabled_language_result("no TSX files in changed_files", "no_tsx_files")
    } else {
        aggregate_scoped_language_results(tsx_scope_results)
    };
    let typescript_deep_layer_status = typescript_result.status;
    let typescript_deep_layer_reason = typescript_result.reason;
    let typescript_verification = typescript_result.verification;
    let tsx_deep_layer_status = tsx_result.status;
    let tsx_deep_layer_reason = tsx_result.reason;
    let tsx_verification = tsx_result.verification;
    let deep_layer_ms = typescript_result.elapsed_ms.max(tsx_result.elapsed_ms);
    let typescript_program_build_count = typescript_result
        .program_build_count
        .max(tsx_result.program_build_count);
    let typescript_program_rebuilt =
        typescript_result.program_rebuilt || tsx_result.program_rebuilt;
    let typescript_snapshot_id = if !typescript_files.is_empty() {
        typescript_result.snapshot_id
    } else {
        tsx_result.snapshot_id
    };

    // Python Deep Layer: reuse one process while switching deterministically between config roots.
    let py_files = files_for_language(&grouped_files, "Python");
    let py_result = if py_files.is_empty() {
        disabled_language_result("no Python files in changed_files", "no_python_files")
    } else {
        let mut scoped = Vec::new();
        for scope in group_files_by_config_root(
            &idx.root,
            &py_files,
            &["pyrightconfig.json", "pyproject.toml"],
        ) {
            let scope_name = config_scope_name(&idx.root, &scope.root);
            let mut result = py_deep_layer::run(py_layer, &scope.root, &scope.helper_files);
            result.snapshot_id = scoped_snapshot_id(
                &idx.root,
                &scope.root,
                &scope.helper_files,
                &["pyrightconfig.json", "pyproject.toml"],
                &result.snapshot_id,
            );
            result.snapshot_id = verification_snapshot_id(
                &result.snapshot_id,
                result.status,
                result.reason.as_deref(),
                &result.issues,
                &result.verification,
                None,
            );
            rebase_scoped_issues(&mut result.issues, &scope_name);
            issues.extend(result.issues);
            scoped.push(ScopedLanguageResult {
                scope: scope_name,
                files: scope.workspace_files,
                status: result.status,
                reason: result.reason,
                verification: result.verification,
                program_build_count: result.program_build_count,
                program_rebuilt: result.program_rebuilt,
                snapshot_id: result.snapshot_id,
                elapsed_ms: result.elapsed_ms,
            });
        }
        aggregate_scoped_language_results(scoped)
    };
    let py_verification = py_result.verification;
    let py_program_build_count = py_result.program_build_count;
    let py_program_rebuilt = py_result.program_rebuilt;
    let py_snapshot_id = py_result.snapshot_id;
    let py_deep_layer_ms = py_result.elapsed_ms;
    let py_deep_layer_status = py_result.status;
    let py_deep_layer_reason = py_result.reason;

    // Rust Deep Layer: reuse one process while switching deterministically between crate roots.
    let rs_files = files_for_language(&grouped_files, "Rust");
    let rust_result = if rs_files.is_empty() {
        disabled_language_result("no Rust files in changed_files", "no_rust_files")
    } else {
        let mut scoped = Vec::new();
        for scope in group_files_by_config_root(
            &idx.root,
            &rs_files,
            &["Cargo.toml", "rust-project.json"],
        ) {
            let scope_name = config_scope_name(&idx.root, &scope.root);
            let mut result = rust_deep_layer::run(rust_layer, &scope.root, &scope.helper_files);
            result.snapshot_id = scoped_snapshot_id(
                &idx.root,
                &scope.root,
                &scope.helper_files,
                &["Cargo.toml", "rust-project.json"],
                &result.snapshot_id,
            );
            result.snapshot_id = verification_snapshot_id(
                &result.snapshot_id,
                result.status,
                result.reason.as_deref(),
                &result.issues,
                &result.verification,
                None,
            );
            rebase_scoped_issues(&mut result.issues, &scope_name);
            issues.extend(result.issues);
            scoped.push(ScopedLanguageResult {
                scope: scope_name,
                files: scope.workspace_files,
                status: result.status,
                reason: result.reason,
                verification: result.verification,
                program_build_count: result.program_build_count,
                program_rebuilt: result.program_rebuilt,
                snapshot_id: result.snapshot_id,
                elapsed_ms: result.elapsed_ms,
            });
        }
        aggregate_scoped_language_results(scoped)
    };
    let rust_verification = rust_result.verification;
    let rust_program_build_count = rust_result.program_build_count;
    let rust_program_rebuilt = rust_result.program_rebuilt;
    let rust_snapshot_id = rust_result.snapshot_id;
    let rust_deep_layer_ms = rust_result.elapsed_ms;
    let rust_deep_layer_status = rust_result.status;
    let rust_deep_layer_reason = rust_result.reason;

    // Go Deep Layer: one persistent gopls session for diagnostics and structure.
    let go_files = files_for_language(&grouped_files, "Go");
    let mut go_result = if go_files.is_empty() {
        go_deep_layer::GoDeepLayerResult {
            issues: vec![],
            status: "disabled",
            reason: Some("no Go files in changed_files".to_string()),
            verification: json!({ "coverage": [], "missing": ["go_documents"] }),
            program_build_count: 0,
            program_rebuilt: false,
            snapshot_id: "0".to_string(),
            elapsed_ms: 0,
        }
    } else {
        go_deep_layer::run(go_layer, &idx.root, &go_files)
    };
    if !go_files.is_empty() {
        let input_snapshot_id = scoped_snapshot_id(
            &idx.root,
            &idx.root,
            &go_files,
            &["go.mod", "go.work"],
            &go_result.snapshot_id,
        );
        go_result.snapshot_id = verification_snapshot_id(
            &input_snapshot_id,
            go_result.status,
            go_result.reason.as_deref(),
            &go_result.issues,
            &go_result.verification,
            None,
        );
    }
    let go_verification = go_result.verification.clone();
    let go_program_build_count = go_result.program_build_count;
    let go_program_rebuilt = go_result.program_rebuilt;
    let go_snapshot_id = go_result.snapshot_id.clone();
    issues.extend(go_result.issues);
    let go_deep_layer_ms = go_result.elapsed_ms;
    let go_deep_layer_status = go_result.status;
    let go_deep_layer_reason = go_result.reason;

    // Java Deep Layer: one persistent Eclipse JDT Language Server session.
    let java_files = files_for_language(&grouped_files, "Java");
    let mut java_result = if java_files.is_empty() {
        java_deep_layer::JavaDeepLayerResult {
            issues: vec![],
            status: "disabled",
            reason: Some("no Java files in changed_files".to_string()),
            verification: json!({ "coverage": [], "missing": ["no_java_files"] }),
            program_build_count: 0,
            program_rebuilt: false,
            snapshot_id: "0".to_string(),
            elapsed_ms: 0,
        }
    } else {
        java_deep_layer::run(java_layer, &idx.root, &java_files)
    };
    if !java_files.is_empty() {
        let input_snapshot_id = scoped_snapshot_id(
            &idx.root,
            &idx.root,
            &java_files,
            &["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"],
            &java_result.snapshot_id,
        );
        java_result.snapshot_id = verification_snapshot_id(
            &input_snapshot_id,
            java_result.status,
            java_result.reason.as_deref(),
            &java_result.issues,
            &java_result.verification,
            None,
        );
    }
    let java_verification = java_result.verification.clone();
    let java_program_build_count = java_result.program_build_count;
    let java_program_rebuilt = java_result.program_rebuilt;
    let java_snapshot_id = java_result.snapshot_id.clone();
    issues.extend(java_result.issues);
    let java_deep_layer_ms = java_result.elapsed_ms;
    let java_deep_layer_status = java_result.status;
    let java_deep_layer_reason = java_result.reason;

    // SQL Deep Layer: syntax/lint checking via sqlfluff / fallback
    let sql_files = files_for_language(&grouped_files, "SQL");
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
    let shell_files = files_for_language(&grouped_files, "Shell");
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
    let cs_files = files_for_language(&grouped_files, "C#");
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
    let php_files = files_for_language(&grouped_files, "PHP");
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
    let ruby_files = files_for_language(&grouped_files, "Ruby");
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
    let kotlin_files = files_for_language(&grouped_files, "Kotlin");
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

    // Dart Deep Layer: dart analyze syntax/type checking
    let dart_files = files_for_language(&grouped_files, "Dart");
    let dart_result = if dart_files.is_empty() {
        dart_deep_layer::DartDeepLayerResult {
            issues: vec![],
            status: "disabled",
            reason: Some("no Dart files in changed_files".to_string()),
            elapsed_ms: 0,
        }
    } else {
        dart_deep_layer::run(dart_layer, &idx.root, &dart_files)
    };
    issues.extend(dart_result.issues);
    let dart_deep_layer_ms = dart_result.elapsed_ms;
    let dart_deep_layer_status = dart_result.status;
    let dart_deep_layer_reason = dart_result.reason;

    // Swift Deep Layer: swiftc syntax checking
    let swift_files = files_for_language(&grouped_files, "Swift");
    let swift_result = if swift_files.is_empty() {
        swift_deep_layer::SwiftDeepLayerResult {
            issues: vec![],
            status: "disabled",
            reason: Some("no Swift files in changed_files".to_string()),
            elapsed_ms: 0,
        }
    } else {
        swift_deep_layer::run(swift_layer, &idx.root, &swift_files)
    };
    issues.extend(swift_result.issues);
    let swift_deep_layer_ms = swift_result.elapsed_ms;
    let swift_deep_layer_status = swift_result.status;
    let swift_deep_layer_reason = swift_result.reason;

    // C/C++ Deep Layer: clang/gcc syntax checking
    let cpp_files = files_for_language(&grouped_files, "C/C++");
    let cpp_result = if cpp_files.is_empty() {
        cpp_deep_layer::CppDeepLayerResult {
            issues: vec![],
            status: "disabled",
            reason: Some("no C/C++ files in changed_files".to_string()),
            elapsed_ms: 0,
        }
    } else {
        cpp_deep_layer::run(cpp_layer, &idx.root, &cpp_files)
    };
    issues.extend(cpp_result.issues);
    let cpp_deep_layer_ms = cpp_result.elapsed_ms;
    let cpp_deep_layer_status = cpp_result.status;
    let cpp_deep_layer_reason = cpp_result.reason;

    let elapsed_ms = t0.elapsed().as_millis();
    let mut verification = build_verification_summary(
        &changed_files,
        &[
            VerificationLayerResult {
                language: "TypeScript",
                files: &typescript_files,
                status: typescript_deep_layer_status,
                reason: typescript_deep_layer_reason.as_deref(),
                verification: Some(&typescript_verification),
            },
            VerificationLayerResult {
                language: "TSX",
                files: &tsx_files,
                status: tsx_deep_layer_status,
                reason: tsx_deep_layer_reason.as_deref(),
                verification: Some(&tsx_verification),
            },
            VerificationLayerResult {
                language: "Python",
                files: &py_files,
                status: py_deep_layer_status,
                reason: py_deep_layer_reason.as_deref(),
                verification: Some(&py_verification),
            },
            VerificationLayerResult {
                language: "Rust",
                files: &rs_files,
                status: rust_deep_layer_status,
                reason: rust_deep_layer_reason.as_deref(),
                verification: Some(&rust_verification),
            },
            VerificationLayerResult {
                language: "Go",
                files: &go_files,
                status: go_deep_layer_status,
                reason: go_deep_layer_reason.as_deref(),
                verification: Some(&go_verification),
            },
            VerificationLayerResult {
                language: "Java",
                files: &java_files,
                status: java_deep_layer_status,
                reason: java_deep_layer_reason.as_deref(),
                verification: Some(&java_verification),
            },
            VerificationLayerResult {
                language: "SQL",
                files: &sql_files,
                status: sql_deep_layer_status,
                reason: sql_deep_layer_reason.as_deref(),
                verification: None,
            },
            VerificationLayerResult {
                language: "Shell",
                files: &shell_files,
                status: shell_deep_layer_status,
                reason: shell_deep_layer_reason.as_deref(),
                verification: None,
            },
            VerificationLayerResult {
                language: "C#",
                files: &cs_files,
                status: csharp_deep_layer_status,
                reason: csharp_deep_layer_reason.as_deref(),
                verification: None,
            },
            VerificationLayerResult {
                language: "PHP",
                files: &php_files,
                status: php_deep_layer_status,
                reason: php_deep_layer_reason.as_deref(),
                verification: None,
            },
            VerificationLayerResult {
                language: "Ruby",
                files: &ruby_files,
                status: ruby_deep_layer_status,
                reason: ruby_deep_layer_reason.as_deref(),
                verification: None,
            },
            VerificationLayerResult {
                language: "Kotlin",
                files: &kotlin_files,
                status: kotlin_deep_layer_status,
                reason: kotlin_deep_layer_reason.as_deref(),
                verification: None,
            },
            VerificationLayerResult {
                language: "Dart",
                files: &dart_files,
                status: dart_deep_layer_status,
                reason: dart_deep_layer_reason.as_deref(),
                verification: None,
            },
            VerificationLayerResult {
                language: "Swift",
                files: &swift_files,
                status: swift_deep_layer_status,
                reason: swift_deep_layer_reason.as_deref(),
                verification: None,
            },
            VerificationLayerResult {
                language: "C/C++",
                files: &cpp_files,
                status: cpp_deep_layer_status,
                reason: cpp_deep_layer_reason.as_deref(),
                verification: None,
            },
        ],
    );
    if !outside_workspace_files.is_empty() {
        let status = if verification.get("status").and_then(Value::as_str) == Some("not_covered") {
            "not_covered"
        } else {
            "partially_verified"
        };
        verification["status"] = json!(status);
        verification["fully_verified"] = json!(false);
        verification["requested_files"] = json!(changed_files.len() + outside_workspace_files.len());
        verification["outside_workspace_files"] = json!(outside_workspace_files);
        if let Some(not_covered) = verification["not_covered_files"].as_array_mut() {
            not_covered.extend(outside_workspace_files.iter().cloned().map(Value::String));
        }
        if let Some(language_results) = verification["language_results"].as_array_mut() {
            language_results.push(json!({
                "language": "unknown",
                "files": outside_workspace_files,
                "status": "not_covered",
                "reason": "outside_workspace",
                "checks_performed": [],
                "missing": ["outside_workspace"],
                "verification": {
                    "coverage": [],
                    "missing": ["outside_workspace"],
                },
            }));
        }
    }
    let status = verification_result_status(!issues.is_empty(), &verification);
    let mut result = json!({
        "status": status,
        "verification": verification,
        "checked_files": changed_files.len(),
        "outside_workspace_files": outside_workspace_files,
        "elapsed_ms": elapsed_ms,
        "refresh_ms": refresh_ms,
        "verify_ms": verify_ms,
        "deep_layer_ms": deep_layer_ms,
        "semantic_engine": "language_semantic_programs",
        "semantic_snapshot_id": typescript_snapshot_id,
        "program_build_count": typescript_program_build_count,
        "program_rebuilt": typescript_program_rebuilt,
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
        "dart_deep_layer_ms": dart_deep_layer_ms,
        "swift_deep_layer_ms": swift_deep_layer_ms,
        "cpp_deep_layer_ms": cpp_deep_layer_ms,
        "issues": issues,
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
        "dart_deep_layer": {
            "status": dart_deep_layer_status,
            "reason": dart_deep_layer_reason,
        },
        "swift_deep_layer": {
            "status": swift_deep_layer_status,
            "reason": swift_deep_layer_reason,
        },
        "cpp_deep_layer": {
            "status": cpp_deep_layer_status,
            "reason": cpp_deep_layer_reason,
        },
    });
    result["py_deep_layer"]["verification"] = py_verification;
    result["py_deep_layer"]["semantic_snapshot_id"] = json!(py_snapshot_id);
    result["py_deep_layer"]["program_build_count"] = json!(py_program_build_count);
    result["py_deep_layer"]["program_rebuilt"] = json!(py_program_rebuilt);
    result["rust_deep_layer"]["verification"] = rust_verification;
    result["rust_deep_layer"]["semantic_snapshot_id"] = json!(rust_snapshot_id);
    result["rust_deep_layer"]["program_build_count"] = json!(rust_program_build_count);
    result["rust_deep_layer"]["program_rebuilt"] = json!(rust_program_rebuilt);
    result["go_deep_layer"]["verification"] = go_verification;
    result["go_deep_layer"]["semantic_snapshot_id"] = json!(go_snapshot_id);
    result["go_deep_layer"]["program_build_count"] = json!(go_program_build_count);
    result["go_deep_layer"]["program_rebuilt"] = json!(go_program_rebuilt);
    result["java_deep_layer"]["verification"] = java_verification;
    result["java_deep_layer"]["semantic_snapshot_id"] = json!(java_snapshot_id);
    result["java_deep_layer"]["program_build_count"] = json!(java_program_build_count);
    result["java_deep_layer"]["program_rebuilt"] = json!(java_program_rebuilt);

    tool_success("pre_verify", result)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn tsx_fixture_index() -> Option<Index> {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/tsx");
        let mut index = Index::new(root);
        index.build();
        Some(index)
    }

    fn typescript_reference_index() -> Option<Index> {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("fixtures/typescript-reference");
        let mut index = Index::new(root);
        index.build();
        Some(index)
    }

    fn structure_contract_index() -> Option<Index> {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("fixtures/structure-contract");
        let mut index = Index::new(root);
        index.build();
        Some(index)
    }

    fn ambiguous_symbol_index() -> Option<Index> {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("fixtures/ambiguous-symbol");
        let mut index = Index::new(root);
        index.build();
        Some(index)
    }

    fn call_tool(tool_name: &str, arguments: Value, index: &mut Option<Index>) -> Value {
        let mut deep_layer = None;
        let mut py_layer = None;
        let mut rust_layer = None;
        let mut go_layer = None;
        let mut java_layer = None;
        let mut sql_layer = None;
        let mut shell_layer = None;
        let mut csharp_layer = None;
        let mut php_layer = None;
        let mut ruby_layer = None;
        let mut kotlin_layer = None;
        let mut dart_layer = None;
        let mut swift_layer = None;
        let mut cpp_layer = None;
        handle_tool_call(
            tool_name,
            &arguments,
            index,
            &mut deep_layer,
            &mut py_layer,
            &mut rust_layer,
            &mut go_layer,
            &mut java_layer,
            &mut sql_layer,
            &mut shell_layer,
            &mut csharp_layer,
            &mut php_layer,
            &mut ruby_layer,
            &mut kotlin_layer,
            &mut dart_layer,
            &mut swift_layer,
            &mut cpp_layer,
        )
    }

    fn tool_payload(response: &Value) -> Value {
        serde_json::from_str(
            response
                .pointer("/content/0/text")
                .and_then(Value::as_str)
                .unwrap(),
        )
        .unwrap()
    }

    #[test]
    fn tool_definitions_expose_structural_boundaries() {
        let tools = tool_definitions();
        assert_eq!(
            tools
                .iter()
                .map(|tool| tool.get("inputSchema").cloned().unwrap())
                .collect::<Vec<_>>(),
            vec![
                json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "symbol": { "type": "string" },
                        "path": { "type": "string" },
                        "depth": { "type": "number" },
                    },
                    "required": ["symbol"],
                }),
                json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "changes": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "path": { "type": "string" },
                                    "symbols": { "type": "array", "items": { "type": "string" } },
                                },
                                "required": ["path"],
                            },
                        },
                    },
                    "required": ["changes"],
                }),
                json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "task": { "type": "string" },
                        "target_symbols": { "type": "array", "items": { "type": "string" } },
                        "target_files": { "type": "array", "items": { "type": "string" } },
                    },
                    "required": ["task"],
                }),
                json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "changed_files": { "type": "array", "items": { "type": "string" } },
                    },
                    "required": ["changed_files"],
                }),
            ],
        );
        let context = tools
            .iter()
            .find(|tool| tool.get("name").and_then(Value::as_str) == Some("pre_context"))
            .unwrap();
        let supported = context
            .pointer("/language_capabilities/supported_languages")
            .and_then(Value::as_array)
            .unwrap();

        assert_eq!(
            supported,
            &vec![
                json!("TypeScript"),
                json!("TSX"),
                json!("Python"),
                json!("Rust"),
                json!("Go"),
                json!("Java"),
            ]
        );

        let verify = tools
            .iter()
            .find(|tool| tool.get("name").and_then(Value::as_str) == Some("pre_verify"))
            .unwrap();
        assert_eq!(
            verify.pointer("/language_capabilities/supported_languages"),
            Some(&json!([
                "TypeScript", "TSX", "Python", "Rust", "Go", "Java", "SQL", "Shell",
                "C#", "PHP", "Ruby", "Kotlin", "Dart", "Swift", "C/C++"
            ]))
        );
        assert_eq!(
            verify
                .pointer("/language_capabilities/languages")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(15)
        );
    }

    #[test]
    fn scoped_non_typescript_targets_do_not_start_typescript_analysis() {
        let root = std::env::temp_dir().join(format!(
            "linghun-pre-non-ts-scope-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("sample.py"), "def selected_target():\n    return 1\n").unwrap();
        let mut built = Index::new(root.clone());
        built.build();
        let mut index = Some(built);

        for (tool, arguments) in [
            (
                "pre_context",
                json!({ "symbol": "selected_target", "path": "sample.py" }),
            ),
            (
                "pre_impact",
                json!({ "changes": [{ "path": "sample.py", "symbols": ["selected_target"] }] }),
            ),
            (
                "pre_plan",
                json!({ "task": "edit selected target", "target_files": ["sample.py"], "target_symbols": ["selected_target"] }),
            ),
        ] {
            let payload = tool_payload(&call_tool(tool, arguments, &mut index));
            assert_eq!(
                payload.get("semantic_engine_status"),
                Some(&json!("disabled")),
                "{tool} started TypeScript analysis"
            );
            assert_eq!(payload.get("program_build_count"), Some(&json!(0)), "{tool}");
        }

        let empty = call_tool(
            "pre_impact",
            json!({ "changes": [] }),
            &mut index,
        );
        assert_eq!(empty.get("isError"), Some(&json!(true)));
        assert_eq!(
            empty.pointer("/content/0/text"),
            Some(&json!("changes array must not be empty"))
        );
        drop(index);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn python_plan_recomputes_inputs_for_second_round_related_imports() {
        let root = std::env::temp_dir().join(format!(
            "linghun-python-second-round-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("entry.py"), "from layer1 import selected_target\n").unwrap();
        std::fs::write(root.join("layer1.py"), "from layer2 import selected_target\n").unwrap();
        std::fs::write(root.join("layer2.py"), "def selected_target():\n    return 1\n").unwrap();
        let mut built = Index::new(root.clone());
        built.build();
        let mut index = Some(built);

        let payload = tool_payload(&call_tool(
            "pre_plan",
            json!({
                "task": "edit selected target",
                "target_files": ["entry.py"],
                "target_symbols": ["selected_target"],
            }),
            &mut index,
        ));
        assert!(payload
            .pointer("/answer_pack/affected_files")
            .and_then(Value::as_array)
            .is_some_and(|files| files.contains(&json!("layer2.py"))));

        drop(index);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn pre_verify_rejects_outside_workspace_before_language_helpers() {
        let root = std::env::temp_dir().join(format!(
            "linghun-pre-verify-root-{}",
            std::process::id()
        ));
        let outside = root.with_file_name(format!(
            "linghun-pre-verify-outside-{}.ts",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_file(&outside);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(&outside, "export const outside = true;\n").unwrap();
        let mut index = Some(Index::new(root.clone()));
        index.as_mut().unwrap().build();

        let response = call_tool(
            "pre_verify",
            json!({ "changed_files": [outside.to_string_lossy()] }),
            &mut index,
        );
        let payload = tool_payload(&response);

        assert_eq!(payload.get("status"), Some(&json!("not_covered")));
        assert_eq!(payload.get("checked_files"), Some(&json!(0)));
        assert_eq!(
            payload.pointer("/verification/fully_verified"),
            Some(&json!(false))
        );
        assert_eq!(
            payload.pointer("/verification/language_results/0/reason"),
            Some(&json!("outside_workspace"))
        );
        assert_eq!(
            payload.pointer("/verification/outside_workspace_files/0"),
            Some(&json!(outside.to_string_lossy()))
        );

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_file(outside).unwrap();
    }

    #[test]
    fn structural_tools_preserve_outside_only_paths_as_not_covered() {
        for (tool, arguments) in [
            ("pre_context", json!({ "symbol": "Button", "path": "../outside.ts" })),
            ("pre_impact", json!({ "changes": [{ "path": "../outside.ts", "symbols": ["Button"] }] })),
            ("pre_plan", json!({ "task": "edit Button", "target_files": ["../outside.ts"], "target_symbols": ["Button"] })),
        ] {
            let response = call_tool(tool, arguments, &mut tsx_fixture_index());
            let payload = tool_payload(&response);
            assert_eq!(payload.get("status"), Some(&json!("not_covered")), "{tool}");
            assert_eq!(payload.get("reason"), Some(&json!("outside_workspace")), "{tool}");
            assert_eq!(payload.pointer("/outside_workspace_files/0"), Some(&json!("../outside.ts")), "{tool}");
            assert_eq!(payload.pointer("/not_covered_files/0"), Some(&json!("../outside.ts")), "{tool}");
            assert!(payload.get("anchor_symbols").is_none(), "{tool} entered discovery");
        }
    }

    #[test]
    fn pre_plan_mixed_paths_only_plans_accepted_files() {
        let response = call_tool(
            "pre_plan",
            json!({
                "task": "edit Button",
                "target_files": ["components.tsx", "../outside.ts"],
                "target_symbols": ["Button"],
            }),
            &mut tsx_fixture_index(),
        );
        let payload = tool_payload(&response);
        assert_ne!(payload.get("status"), Some(&json!("not_covered")));
        assert_eq!(payload.pointer("/outside_workspace_files/0"), Some(&json!("../outside.ts")));
        assert!(payload
            .get("edit_order")
            .and_then(Value::as_array)
            .is_some_and(|steps| steps.iter().all(|step| {
                step.get("file").and_then(Value::as_str) != Some("../outside.ts")
            })));
        assert!(payload
            .pointer("/answer_pack/missing_evidence")
            .and_then(Value::as_array)
            .is_some_and(|missing| missing.contains(&json!("outside_workspace"))));
    }

    #[test]
    fn tool_success_preserves_envelope_and_adds_capabilities() {
        let response = tool_success("pre_context", json!({ "legacy_field": true }));
        let text = response
            .pointer("/content/0/text")
            .and_then(Value::as_str)
            .unwrap();
        let payload: Value = serde_json::from_str(text).unwrap();

        assert_eq!(payload.get("legacy_field"), Some(&json!(true)));
        assert_eq!(
            payload.pointer("/capability_summary/tool"),
            Some(&json!("pre_context"))
        );
        assert!(payload.pointer("/capability_summary/languages").is_none());
        assert_eq!(
            payload.pointer("/capability_summary/partial_languages"),
            Some(&json!([]))
        );
    }

    #[test]
    fn fallback_is_never_reported_as_fully_verified() {
        let files = vec!["src/view.tsx".to_string()];
        let summary = build_verification_summary(
            &files,
            &[VerificationLayerResult {
                language: "TSX",
                files: &files,
                status: "fallback_used",
                reason: Some("TypeScript unavailable; AST fallback used"),
                verification: None,
            }],
        );

        assert_eq!(summary.get("status"), Some(&json!("fallback_used")));
        assert_eq!(summary.get("fully_verified"), Some(&json!(false)));
        assert_eq!(summary.get("missing_tools"), Some(&json!([])));
    }

    #[test]
    fn invalid_tsconfig_fallback_does_not_report_typescript_missing() {
        let files = vec!["src/types.ts".to_string()];
        let metadata = json!({
            "coverage": ["syntax", "types", "module_resolution"],
            "missing": ["valid_tsconfig"],
        });
        let summary = build_verification_summary(
            &files,
            &[VerificationLayerResult {
                language: "TypeScript",
                files: &files,
                status: "fallback_used",
                reason: Some("tsconfig=tsconfig.json; missing=valid_tsconfig"),
                verification: Some(&metadata),
            }],
        );

        assert_eq!(summary.get("status"), Some(&json!("fallback_used")));
        assert_eq!(summary.get("missing_tools"), Some(&json!([])));
        assert_eq!(
            summary.pointer("/language_results/0/missing/0"),
            Some(&json!("valid_tsconfig"))
        );
    }

    #[test]
    fn canonical_tool_missing_is_never_reported_as_verified() {
        let files = vec!["src/view.tsx".to_string()];
        let summary = build_verification_summary(
            &files,
            &[VerificationLayerResult {
                language: "TSX",
                files: &files,
                status: "tool_missing",
                reason: Some("TypeScript package not available"),
                verification: None,
            }],
        );

        assert_eq!(summary.get("status"), Some(&json!("tool_missing")));
        assert_eq!(summary.get("fully_verified"), Some(&json!(false)));
        assert_eq!(summary.get("missing_tools"), Some(&json!(["typescript"])));
        assert_eq!(verification_result_status(false, &summary), "tool_missing");
    }

    #[test]
    fn canonical_verified_status_remains_fully_verified() {
        let files = vec!["src/view.tsx".to_string()];
        let summary = build_verification_summary(
            &files,
            &[VerificationLayerResult {
                language: "TSX",
                files: &files,
                status: "verified",
                reason: None,
                verification: None,
            }],
        );

        assert_eq!(summary.get("status"), Some(&json!("verified")));
        assert_eq!(summary.get("fully_verified"), Some(&json!(true)));
        assert_eq!(verification_result_status(false, &summary), "pass");
    }

    #[test]
    fn go_verification_degradation_contract_is_preserved() {
        struct Case {
            status: &'static str,
            reason: Option<&'static str>,
            missing: &'static [&'static str],
            expected_status: &'static str,
            expected_missing_tools: &'static [&'static str],
        }

        let cases = [
            Case {
                status: "partially_verified",
                reason: Some("no Go documents"),
                missing: &["go_documents"],
                expected_status: "partially_verified",
                expected_missing_tools: &[],
            },
            Case {
                status: "tool_missing",
                reason: Some("gopls_not_found"),
                missing: &["gopls"],
                expected_status: "tool_missing",
                expected_missing_tools: &["gopls"],
            },
            Case {
                status: "partially_verified",
                reason: Some("gopls_protocol_error"),
                missing: &["gopls_diagnostics"],
                expected_status: "partially_verified",
                expected_missing_tools: &[],
            },
            Case {
                status: "verified",
                reason: Some("gopls_diagnostics_complete"),
                missing: &[],
                expected_status: "verified",
                expected_missing_tools: &[],
            },
        ];

        for case in cases {
            let files = vec!["service.go".to_string()];
            let verification = json!({
                "coverage": if case.status == "verified" { json!(["gopls_diagnostics"]) } else { json!([]) },
                "missing": case.missing,
            });
            let summary = build_verification_summary(
                &files,
                &[VerificationLayerResult {
                    language: "Go",
                    files: &files,
                    status: case.status,
                    reason: case.reason,
                    verification: Some(&verification),
                }],
            );

            assert_eq!(summary.get("status"), Some(&json!(case.expected_status)));
            assert_eq!(summary.get("fully_verified"), Some(&json!(case.status == "verified")));
            assert_eq!(summary.pointer("/language_results/0/missing"), Some(&json!(case.missing)));
            assert_eq!(summary.get("missing_tools"), Some(&json!(case.expected_missing_tools)));
        }
    }

    #[test]
    fn missing_tools_and_uncovered_files_are_explicit() {
        let changed_files = vec!["src/service.cs".to_string(), "README.md".to_string()];
        let csharp_files = vec!["src/service.cs".to_string()];
        let summary = build_verification_summary(
            &changed_files,
            &[VerificationLayerResult {
                language: "C#",
                files: &csharp_files,
                status: "unavailable",
                reason: Some("dotnet not found"),
                verification: None,
            }],
        );

        assert_eq!(summary.get("status"), Some(&json!("partially_verified")));
        assert_eq!(summary.get("fully_verified"), Some(&json!(false)));
        assert_eq!(summary.get("missing_tools"), Some(&json!(["dotnet"])));
        assert_eq!(
            summary.get("not_covered_files"),
            Some(&json!(["README.md"]))
        );
    }

    #[test]
    fn normalizes_helper_statuses_without_false_verification_or_missing_tools() {
        struct Case {
            name: &'static str,
            status: &'static str,
            reason: Option<&'static str>,
            has_issues: bool,
            expected_summary: &'static str,
            expected_top_level: &'static str,
            expected_missing_tools: &'static [&'static str],
        }

        let cases = [
            Case { name: "jdt verified", status: "verified", reason: None, has_issues: false, expected_summary: "verified", expected_top_level: "pass", expected_missing_tools: &[] },
            Case { name: "jdt diagnostics", status: "verified", reason: None, has_issues: true, expected_summary: "verified", expected_top_level: "issues_found", expected_missing_tools: &[] },
            Case { name: "helper error", status: "error", reason: Some("helper_exception"), has_issues: false, expected_summary: "partially_verified", expected_top_level: "partially_verified", expected_missing_tools: &[] },
            Case { name: "unknown status", status: "mystery", reason: None, has_issues: false, expected_summary: "partially_verified", expected_top_level: "partially_verified", expected_missing_tools: &[] },
            Case { name: "jdk absent", status: "tool_missing", reason: Some("Java tool_missing: JDK java not found; missing=jdk"), has_issues: false, expected_summary: "tool_missing", expected_top_level: "tool_missing", expected_missing_tools: &["jdk"] },
            Case { name: "jdtls absent", status: "tool_missing", reason: Some("Java tool_missing: Eclipse JDT Language Server not found; missing=jdtls"), has_issues: false, expected_summary: "tool_missing", expected_top_level: "tool_missing", expected_missing_tools: &["jdtls"] },
            Case { name: "helper unavailable", status: "unavailable", reason: Some("java deep-layer subprocess did not respond"), has_issues: false, expected_summary: "partially_verified", expected_top_level: "partially_verified", expected_missing_tools: &[] },
        ];

        for case in cases {
            let files = vec!["src/Main.java".to_string()];
            let summary = build_verification_summary(
                &files,
                &[VerificationLayerResult {
                    language: "Java",
                    files: &files,
                    status: case.status,
                    reason: case.reason,
                    verification: None,
                }],
            );

            assert_eq!(summary.get("status"), Some(&json!(case.expected_summary)), "{}", case.name);
            assert_eq!(
                verification_result_status(case.has_issues, &summary),
                case.expected_top_level,
                "{}",
                case.name
            );
            assert_eq!(
                summary.get("missing_tools"),
                Some(&json!(case.expected_missing_tools)),
                "{}",
                case.name
            );
            assert_eq!(
                summary.pointer("/language_results/0/validator_status"),
                Some(&json!(case.status)),
                "{}",
                case.name
            );
        }
    }

    #[test]
    fn structural_handlers_reject_verify_only_paths_and_report_parse_errors() {
        let mut index = structure_contract_index();
        assert_eq!(index.as_ref().unwrap().file_count(), 3);

        let uppercase = call_tool(
            "pre_context",
            json!({ "symbol": "upperTarget", "path": "VALID.TS" }),
            &mut index,
        );
        let uppercase_payload = tool_payload(&uppercase);
        assert_eq!(
            uppercase_payload.pointer("/definition/name"),
            Some(&json!("upperTarget"))
        );

        for (tool, arguments) in [
            ("pre_context", json!({ "symbol": "accounts", "path": "query.sql" })),
            ("pre_plan", json!({ "task": "change query", "target_files": ["query.sql"] })),
            ("pre_impact", json!({ "changes": [{ "path": "query.sql", "symbols": ["accounts"] }] })),
        ] {
            let response = call_tool(tool, arguments, &mut index);
            let payload = tool_payload(&response);
            assert_eq!(payload.get("status"), Some(&json!("not_covered")), "{tool}");
            assert_eq!(payload.get("confidence"), Some(&json!("low")), "{tool}");
        }

        let context = call_tool(
            "pre_context",
            json!({ "symbol": "broken", "path": "invalid.ts" }),
            &mut index,
        );
        let context_payload = tool_payload(&context);
        assert_eq!(context_payload.get("parse_errors"), Some(&json!(["invalid.ts"])));
        assert_ne!(
            context_payload.pointer("/answer_pack/confidence"),
            Some(&json!("high"))
        );
        assert!(context_payload
            .pointer("/answer_pack/missing_evidence")
            .and_then(Value::as_array)
            .unwrap()
            .contains(&json!("parse_errors")));

        let plan = call_tool(
            "pre_plan",
            json!({ "task": "repair parser error", "target_files": ["invalid.ts"] }),
            &mut index,
        );
        let plan_payload = tool_payload(&plan);
        assert_eq!(plan_payload.get("parse_errors"), Some(&json!(["invalid.ts"])));
        assert_eq!(plan_payload.pointer("/answer_pack/confidence"), Some(&json!("medium")));

        let impact = call_tool(
            "pre_impact",
            json!({ "changes": [{ "path": "invalid.ts", "symbols": ["broken"] }] }),
            &mut index,
        );
        let impact_payload = tool_payload(&impact);
        assert_eq!(impact_payload.get("parse_errors"), Some(&json!(["invalid.ts"])));
        assert_ne!(impact_payload.pointer("/answer_pack/confidence"), Some(&json!("high")));
        assert_eq!(
            language::capability_for_name("TypeScript").unwrap().current_status,
            language::CurrentStatus::ProductGrade
        );
    }

    #[test]
    fn impact_deduplicates_and_bounds_evidence() {
        let mut index = structure_contract_index();
        let mut symbols = vec![json!("hot"), json!("hot")];
        symbols.extend((0..150).map(|index| json!(format!("seed{index}"))));
        let impact = call_tool(
            "pre_impact",
            json!({ "changes": [{ "path": "many-references.ts", "symbols": symbols }] }),
            &mut index,
        );
        let payload = tool_payload(&impact);

        assert_eq!(payload.get("seed_symbols").and_then(Value::as_array).unwrap().len(), 100);
        assert_eq!(payload.get("seed_symbols_truncated"), Some(&json!(true)));
        assert_eq!(payload.get("affected_references").and_then(Value::as_array).unwrap().len(), 200);
        assert_eq!(payload.get("affected_references_truncated"), Some(&json!(true)));
        assert_eq!(payload.pointer("/truncated/seed_symbols"), Some(&json!(true)));
        assert_eq!(payload.pointer("/truncated/affected_references"), Some(&json!(true)));
        assert!(payload
            .pointer("/answer_pack/suggested_minimal_reads")
            .and_then(Value::as_array)
            .unwrap()
            .len()
            <= MAX_IMPACT_MINIMAL_READS);
    }

    #[test]
    fn impact_minimal_reads_report_when_truncated() {
        let mut reads: Vec<Value> = (0..=MAX_IMPACT_MINIMAL_READS)
            .map(|index| read_hint(format!("src/file-{index}.ts"), 1, "test"))
            .collect();

        assert!(truncate_impact_minimal_reads(&mut reads));
        assert_eq!(reads.len(), MAX_IMPACT_MINIMAL_READS);
    }

    #[test]
    fn context_does_not_choose_an_ambiguous_definition() {
        let mut index = ambiguous_symbol_index();
        let context = call_tool("pre_context", json!({ "symbol": "Collision" }), &mut index);
        let payload = tool_payload(&context);

        assert_eq!(payload.get("definition"), Some(&Value::Null));
        assert_eq!(
            payload
                .get("definition_candidates")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(2)
        );
        assert_eq!(payload.pointer("/answer_pack/confidence"), Some(&json!("low")));
        assert!(payload
            .pointer("/answer_pack/missing_evidence")
            .and_then(Value::as_array)
            .unwrap()
            .contains(&json!("ambiguous_definitions")));
    }

    #[test]
    fn registry_grouping_dispatches_product_grade_and_verify_only_languages() {
        let changed_files = vec![
            "src/component.TSX".to_string(),
            "src/types.MTS".to_string(),
            "db/query.SQL".to_string(),
            "README.md".to_string(),
        ];
        let grouped = group_changed_files_by_language(&changed_files);

        assert_eq!(grouped.get("TSX"), Some(&vec!["src/component.TSX".to_string()]));
        assert_eq!(grouped.get("TypeScript"), Some(&vec!["src/types.MTS".to_string()]));
        assert_eq!(grouped.get("SQL"), Some(&vec!["db/query.SQL".to_string()]));

        let tsx_files = files_for_language(&grouped, "TSX");
        let typescript_files = files_for_language(&grouped, "TypeScript");
        let sql_files = files_for_language(&grouped, "SQL");
        let summary = build_verification_summary(
            &changed_files,
            &[
                VerificationLayerResult { language: "TSX", files: &tsx_files, status: "verified", reason: None, verification: None },
                VerificationLayerResult { language: "TypeScript", files: &typescript_files, status: "verified", reason: None, verification: None },
                VerificationLayerResult { language: "SQL", files: &sql_files, status: "tool_missing", reason: Some("sqlfluff_not_found"), verification: None },
            ],
        );
        assert_eq!(summary.get("status"), Some(&json!("partially_verified")));
        assert_eq!(
            summary.get("not_covered_files"),
            Some(&json!(["README.md"]))
        );
        assert_eq!(summary.get("missing_tools"), Some(&json!(["sqlfluff"])));
    }

    #[test]
    fn nested_language_configs_group_files_by_the_nearest_bounded_root() {
        let root = std::env::temp_dir().join(format!(
            "linghun-nested-config-roots-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        for directory in [
            "packages/a/src",
            "packages/b/src",
            "services/b",
            "crates/c/src",
        ] {
            std::fs::create_dir_all(root.join(directory)).unwrap();
        }
        for (file, content) in [
            ("tsconfig.json", "{}"),
            ("packages/a/tsconfig.json", "{}"),
            ("services/b/pyrightconfig.json", "{}"),
            ("crates/c/Cargo.toml", "[package]\nname='c'\nversion='0.1.0'"),
        ] {
            std::fs::write(root.join(file), content).unwrap();
        }

        let ts = group_files_by_config_root(
            &root,
            &["packages/a/src/a.ts".into(), "packages/b/src/b.ts".into()],
            &["tsconfig.json"],
        );
        assert_eq!(ts.len(), 2);
        assert_eq!(config_scope_name(&root, &ts[0].root), "");
        assert_eq!(ts[0].helper_files, vec!["packages/b/src/b.ts"]);
        assert_eq!(config_scope_name(&root, &ts[1].root), "packages/a");
        assert_eq!(ts[1].helper_files, vec!["src/a.ts"]);

        let python = group_files_by_config_root(
            &root,
            &["services/b/app.py".into()],
            &["pyrightconfig.json", "pyproject.toml"],
        );
        assert_eq!(config_scope_name(&root, &python[0].root), "services/b");
        assert_eq!(python[0].helper_files, vec!["app.py"]);

        let rust = group_files_by_config_root(
            &root,
            &["crates/c/src/lib.rs".into()],
            &["Cargo.toml", "rust-project.json"],
        );
        assert_eq!(config_scope_name(&root, &rust[0].root), "crates/c");
        assert_eq!(rust[0].helper_files, vec!["src/lib.rs"]);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn scoped_paths_normalize_workspace_bounded_parent_segments() {
        assert_eq!(
            scoped_path("packages/a", "../shared.ts"),
            Some("packages/shared.ts".to_string())
        );
        assert_eq!(
            scoped_path("packages/a", "../../shared.ts"),
            Some("shared.ts".to_string())
        );
        assert_eq!(scoped_path("packages/a", "../../../outside.ts"), None);
    }

    #[test]
    fn scoped_paths_reject_absolute_unc_and_drive_paths_before_rebasing() {
        for path in [
            "/etc/passwd",
            "//server/share/file.ts",
            r"\\server\share\file.ts",
            "C:/outside/file.ts",
            r"C:\outside\file.ts",
            "C:relative-drive.ts",
            r"\\?\C:\outside\file.ts",
        ] {
            assert_eq!(scoped_path("packages/a", path), None, "accepted {path}");
        }
    }

    #[test]
    fn scoped_helper_refresh_only_returns_workspace_and_scope_accepted_paths() {
        let root = std::env::temp_dir().join(format!(
            "linghun-scoped-helper-refresh-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("packages/a/src")).unwrap();
        std::fs::write(root.join("packages/a/src/value.py"), "value = 1\n").unwrap();
        std::fs::write(root.join("packages/shared.py"), "shared = 1\n").unwrap();
        let mut idx = Index::new(root.clone());
        let mut outside = Vec::new();

        let accepted = refresh_scoped_helper_paths(
            &mut idx,
            "packages/a",
            &[
                "src/value.py".to_string(),
                "../shared.py".to_string(),
                "../../../outside.py".to_string(),
                "C:/outside.py".to_string(),
            ],
            &mut outside,
        );

        assert_eq!(accepted, vec!["../shared.py", "src/value.py"]);
        assert!(!outside.contains(&"packages/shared.py".to_string()));
        assert!(outside.contains(&"../../../outside.py".to_string()));
        assert!(outside.contains(&"C:/outside.py".to_string()));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn scoped_structure_retains_rejected_final_round_paths_as_not_covered() {
        let root = std::env::temp_dir().join(format!(
            "linghun-scoped-final-rejected-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("packages/a/src")).unwrap();
        std::fs::write(root.join("packages/a/src/value.py"), "value = 1\n").unwrap();
        let mut idx = Index::new(root.clone());
        let mut relations = ts_deep_layer::SymbolRelations::default();
        relations.related_files = vec![
            "src/value.py".to_string(),
            "../../../outside.py".to_string(),
        ];
        let mut result = ts_deep_layer::StructureResult {
            relations: HashMap::from([("value".to_string(), relations)]),
            module_dependencies: HashMap::new(),
            status: "verified",
            reason: None,
            program_build_count: 1,
            program_rebuilt: false,
            snapshot_id: "snapshot".to_string(),
            elapsed_ms: 1,
        };
        let mut outside = Vec::new();

        retain_scoped_structure_paths(
            &mut idx,
            "packages/a",
            &mut result,
            &mut outside,
        );

        assert_eq!(result.relations["value"].related_files, vec!["src/value.py"]);
        assert!(result.relations["value"].graph_truncated);
        assert!(outside.contains(&"../../../outside.py".to_string()));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn scoped_snapshot_tracks_source_and_config_content_deterministically() {
        let root = std::env::temp_dir().join(format!(
            "linghun-scoped-snapshot-{}",
            std::process::id()
        ));
        let scope_root = root.join("packages/a");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(scope_root.join("src")).unwrap();
        std::fs::write(scope_root.join("tsconfig.json"), "{}").unwrap();
        std::fs::write(scope_root.join("src/value.ts"), "export const value = 1;\n").unwrap();
        let files = vec!["src/value.ts".to_string()];

        let first = scoped_snapshot_id(
            &root,
            &scope_root,
            &files,
            &["tsconfig.json"],
            "1",
        );
        assert_eq!(
            first,
            scoped_snapshot_id(&root, &scope_root, &files, &["tsconfig.json"], "1")
        );
        assert_eq!(
            first,
            scoped_snapshot_id(&root, &scope_root, &files, &["tsconfig.json"], "999")
        );
        std::fs::write(scope_root.join("src/value.ts"), "export const value = 2;\n").unwrap();
        let source_changed = scoped_snapshot_id(
            &root,
            &scope_root,
            &files,
            &["tsconfig.json"],
            "1",
        );
        assert_ne!(first, source_changed);
        std::fs::write(scope_root.join("tsconfig.json"), r#"{"compilerOptions":{"strict":true}}"#).unwrap();
        let config_changed = scoped_snapshot_id(
            &root,
            &scope_root,
            &files,
            &["tsconfig.json"],
            "1",
        );
        assert_ne!(source_changed, config_changed);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn nested_language_structure_results_rebase_and_merge_deterministically() {
        fn scoped_result(file: &str, status: &'static str) -> ts_deep_layer::StructureResult {
            let mut relations = ts_deep_layer::SymbolRelations::default();
            relations.targets.push(ts_deep_layer::SymbolTarget {
                file: file.to_string(),
                name: "Shared".to_string(),
                line: 1,
                character: 0,
                end_line: 1,
                end_character: 6,
            });
            relations.related_files.push("src/dependency.ts".to_string());
            ts_deep_layer::StructureResult {
                relations: HashMap::from([("Shared".to_string(), relations)]),
                module_dependencies: HashMap::from([(
                    file.to_string(),
                    vec!["src/dependency.ts".to_string()],
                )]),
                status,
                reason: (status != "verified").then(|| "types unavailable".to_string()),
                program_build_count: 1,
                program_rebuilt: false,
                snapshot_id: file.to_string(),
                elapsed_ms: 1,
            }
        }

        let result = aggregate_scoped_structure_results(vec![
            ("packages/b".to_string(), scoped_result("src/shared.ts", "fallback_used")),
            ("packages/a".to_string(), scoped_result("src/shared.ts", "verified")),
        ]);
        let repeated = aggregate_scoped_structure_results(vec![
            ("packages/a".to_string(), scoped_result("src/shared.ts", "verified")),
            ("packages/b".to_string(), scoped_result("src/shared.ts", "fallback_used")),
        ]);

        assert_eq!(result.status, "partially_verified");
        assert_eq!(
            result.module_dependencies.keys().cloned().collect::<BTreeSet<_>>(),
            BTreeSet::from([
                "packages/a/src/shared.ts".to_string(),
                "packages/b/src/shared.ts".to_string(),
            ])
        );
        let targets = &result.relations["Shared"].targets;
        assert_eq!(targets[0].file, "packages/a/src/shared.ts");
        assert_eq!(targets[1].file, "packages/b/src/shared.ts");
        assert_eq!(result.snapshot_id, repeated.snapshot_id);
        assert!(result.snapshot_id.starts_with("scoped:packages/a="));
        assert!(result.snapshot_id.contains("|packages/b="));
    }

    #[test]
    fn nested_language_pre_context_keeps_workspace_relative_paths() {
        let root = std::env::temp_dir().join(format!(
            "linghun-nested-context-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("packages/a/src")).unwrap();
        std::fs::write(
            root.join("packages/a/tsconfig.json"),
            r#"{"compilerOptions":{"strict":true},"include":["src/**/*.ts"]}"#,
        )
        .unwrap();
        std::fs::write(
            root.join("packages/a/src/shared.ts"),
            "export function nestedTarget(): number { return 1; }\n",
        )
        .unwrap();
        std::fs::write(
            root.join("packages/a/src/consumer.ts"),
            "import { nestedTarget } from './shared';\nexport const value = nestedTarget();\n",
        )
        .unwrap();
        let mut built = Index::new(root.clone());
        built.build();
        let mut index = Some(built);

        let response = call_tool(
            "pre_context",
            json!({ "symbol": "nestedTarget", "path": "packages/a/src/shared.ts" }),
            &mut index,
        );
        let payload = tool_payload(&response);
        assert!(payload
            .pointer("/definition/file")
            .and_then(Value::as_str)
            .unwrap()
            .replace('\\', "/")
            .ends_with("/packages/a/src/shared.ts"));
        let payload_text = serde_json::to_string(&payload).unwrap();
        assert!(!payload_text.contains("\"file\":\"src/shared.ts\""));
        assert!(!payload_text.contains("\"file\":\"src/consumer.ts\""));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn nested_language_status_is_conservative_across_scopes() {
        let result = aggregate_scoped_language_results(vec![
            ScopedLanguageResult {
                scope: "packages/a".into(),
                files: vec!["packages/a/src/a.ts".into()],
                status: "verified",
                reason: None,
                verification: json!({ "coverage": ["syntax", "types"], "missing": [] }),
                program_build_count: 1,
                program_rebuilt: false,
                snapshot_id: "1".into(),
                elapsed_ms: 2,
            },
            ScopedLanguageResult {
                scope: "packages/b".into(),
                files: vec!["packages/b/src/b.ts".into()],
                status: "fallback_used",
                reason: Some("typescript unavailable".into()),
                verification: json!({ "coverage": ["syntax"], "missing": ["types"] }),
                program_build_count: 0,
                program_rebuilt: true,
                snapshot_id: "0".into(),
                elapsed_ms: 3,
            },
        ]);

        assert_eq!(result.status, "partially_verified");
        assert_eq!(result.verification["coverage"], json!(["syntax"]));
        assert_eq!(result.verification["missing"], json!(["types"]));
        assert_eq!(result.verification["scopes"].as_array().map(Vec::len), Some(2));
        assert_eq!(result.snapshot_id, "scoped:packages/a=1|packages/b=0");
        assert!(result.program_rebuilt);
    }

    #[test]
    fn typescript_and_tsx_keep_independent_verification_metadata() {
        let changed_files = vec!["src/types.ts".to_string(), "src/view.tsx".to_string()];
        let typescript_files = vec!["src/types.ts".to_string()];
        let tsx_files = vec!["src/view.tsx".to_string()];
        let typescript_metadata = json!({
            "coverage": ["syntax", "types"],
            "missing": [],
            "jsx_mode": "not_configured",
        });
        let tsx_metadata = json!({
            "coverage": ["syntax"],
            "missing": ["jsx_runtime_types"],
            "jsx_mode": "react-jsx",
        });
        let summary = build_verification_summary(
            &changed_files,
            &[
                VerificationLayerResult { language: "TypeScript", files: &typescript_files, status: "verified", reason: None, verification: Some(&typescript_metadata) },
                VerificationLayerResult { language: "TSX", files: &tsx_files, status: "fallback_used", reason: Some("missing JSX runtime types"), verification: Some(&tsx_metadata) },
            ],
        );

        assert_eq!(summary.get("status"), Some(&json!("partially_verified")));
        let results = summary.get("language_results").and_then(Value::as_array).unwrap();
        let typescript = results.iter().find(|result| result.get("language") == Some(&json!("TypeScript"))).unwrap();
        let tsx = results.iter().find(|result| result.get("language") == Some(&json!("TSX"))).unwrap();
        assert_eq!(typescript.pointer("/verification/coverage/1"), Some(&json!("types")));
        assert_eq!(tsx.pointer("/verification/missing/0"), Some(&json!("jsx_runtime_types")));
        assert_eq!(tsx.get("status"), Some(&json!("fallback_used")));
        assert_eq!(summary.get("missing_tools"), Some(&json!([])));
    }

    #[test]
    fn typescript_reference_handlers_cover_all_four_paths() {
        let mut index = typescript_reference_index();

        let context = call_tool("pre_context", json!({ "symbol": "loadAccount" }), &mut index);
        let context_payload = tool_payload(&context);
        assert!(context_payload
            .get("references")
            .and_then(Value::as_array)
            .unwrap()
            .iter()
            .any(|reference| {
                reference
                    .get("file")
                    .and_then(Value::as_str)
                    .is_some_and(|file| file.ends_with("service.ts"))
            }));
        assert!(context_payload
            .get("callers")
            .and_then(Value::as_array)
            .unwrap()
            .iter()
            .any(|caller| caller.get("name") == Some(&json!("describeAccount"))));

        let plan = call_tool(
            "pre_plan",
            json!({ "task": "extend account contract", "target_symbols": ["Account"] }),
            &mut index,
        );
        let plan_payload = tool_payload(&plan);
        let planned_files: HashSet<&str> = plan_payload
            .get("edit_order")
            .and_then(Value::as_array)
            .unwrap()
            .iter()
            .filter_map(|step| step.get("file").and_then(Value::as_str))
            .collect();
        for expected in ["contracts.ts", "repository.ts", "service.ts"] {
            assert!(planned_files.contains(expected), "missing planned file: {expected}");
        }

        let impact = call_tool(
            "pre_impact",
            json!({ "changes": [{ "path": "contracts.ts", "symbols": ["Account"] }] }),
            &mut index,
        );
        let impact_payload = tool_payload(&impact);
        let affected_files = impact_payload
            .get("affected_files")
            .and_then(Value::as_array)
            .unwrap();
        assert!(affected_files.contains(&json!("repository.ts")));
        assert!(affected_files.contains(&json!("service.ts")));

        let verify = call_tool(
            "pre_verify",
            json!({ "changed_files": ["contracts.ts", "repository.ts", "service.ts"] }),
            &mut index,
        );
        let verify_payload = tool_payload(&verify);
        assert_eq!(verify_payload.get("status"), Some(&json!("pass")));
        assert_eq!(
            verify_payload.pointer("/verification/status"),
            Some(&json!("verified"))
        );
        assert_eq!(
            verify_payload.pointer("/verification/language_results/0/language"),
            Some(&json!("TypeScript"))
        );
        assert_eq!(
            verify_payload.pointer("/verification/fully_verified"),
            Some(&json!(true))
        );
    }

    #[test]
    fn typescript_program_snapshot_is_shared_by_structure_and_verify() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/smoke-tsx/valid");
        let files = vec!["component.tsx".to_string()];
        let symbols = vec!["Greeting".to_string()];
        let mut layer = None;

        let structure = ts_deep_layer::run_structure(
            &mut layer,
            &root,
            &files,
            &symbols,
            &files,
        );
        assert_eq!(structure.status, "verified");
        assert!(structure.program_rebuilt);

        let verification = ts_deep_layer::run(&mut layer, &root, &files);
        assert_eq!(verification.status, "verified");
        assert!(!verification.program_rebuilt);
        assert_eq!(verification.program_build_count, structure.program_build_count);
        assert_eq!(verification.snapshot_id, structure.snapshot_id);
    }

    #[test]
    fn tsx_handlers_include_cross_file_context_plan_and_impact() {
        let mut index = tsx_fixture_index();

        let context = call_tool("pre_context", json!({ "symbol": "Item" }), &mut index);
        let context_payload = tool_payload(&context);
        assert!(context_payload
            .get("references")
            .and_then(Value::as_array)
            .unwrap()
            .iter()
            .any(|reference| {
                reference.get("qualified_name") == Some(&json!("Menu.Item"))
                    && reference.get("is_member") == Some(&json!(true))
            }));

        let legacy_context = call_tool("pre_context", json!({ "symbol": "LegacyPanel" }), &mut index);
        let legacy_payload = tool_payload(&legacy_context);
        assert!(legacy_payload
            .get("callees")
            .and_then(Value::as_array)
            .unwrap()
            .iter()
            .any(|callee| {
                callee.get("qualified_name") == Some(&json!("Menu.Item"))
                    && callee.get("is_member") == Some(&json!(true))
            }));

        let shared_button_context = call_tool(
            "pre_context",
            json!({ "symbol": "SharedButton", "path": "dashboard.tsx" }),
            &mut index,
        );
        let shared_button_payload = tool_payload(&shared_button_context);
        assert!(shared_button_payload
            .pointer("/definition/file")
            .and_then(Value::as_str)
            .is_some_and(|file| file.ends_with("shared-button.tsx")));
        assert_eq!(
            shared_button_payload.pointer("/answer_pack/confidence"),
            Some(&json!("high"))
        );
        assert_eq!(
            shared_button_payload.get("index_consistency"),
            Some(&json!("targeted"))
        );
        assert!(!shared_button_payload
            .pointer("/answer_pack/missing_evidence")
            .and_then(Value::as_array)
            .unwrap()
            .contains(&json!("module_resolution")));
        assert!(!shared_button_payload
            .get("unresolved_module_specifiers")
            .and_then(Value::as_array)
            .unwrap()
            .contains(&json!("@/shared-button")));
        let shared_button_references = shared_button_payload
            .get("references")
            .and_then(Value::as_array)
            .unwrap();
        for expected in [
            "barrel.ts",
            "nested-barrel.ts",
            "dashboard.tsx",
            "nested-dashboard.tsx",
            "alias-dashboard.tsx",
        ] {
            assert!(shared_button_references.iter().any(|reference| {
                reference
                    .get("file")
                    .and_then(Value::as_str)
                    .is_some_and(|file| file.ends_with(expected))
            }), "missing SharedButton reference in {expected}");
        }
        assert!(!shared_button_references.iter().any(|reference| {
            reference
                .get("file")
                .and_then(Value::as_str)
                .is_some_and(|file| file.ends_with("unrelated-collision.tsx"))
        }));

        let plan = call_tool(
            "pre_plan",
            json!({
                "task": "update shared button props",
                "target_files": ["dashboard.tsx"],
                "target_symbols": ["SharedButtonProps"]
            }),
            &mut index,
        );
        let plan_payload = tool_payload(&plan);
        assert_eq!(
            plan_payload.pointer("/answer_pack/confidence"),
            Some(&json!("high"))
        );
        assert!(!plan_payload
            .pointer("/answer_pack/missing_evidence")
            .and_then(Value::as_array)
            .unwrap()
            .contains(&json!("module_resolution")));
        let planned_files: HashSet<&str> = plan_payload
            .get("edit_order")
            .and_then(Value::as_array)
            .unwrap()
            .iter()
            .filter_map(|step| step.get("file").and_then(Value::as_str))
            .collect();
        for expected in [
            "shared-props.ts",
            "shared-button.tsx",
            "barrel.ts",
            "nested-barrel.ts",
            "dashboard.tsx",
            "nested-dashboard.tsx",
            "alias-dashboard.tsx",
        ] {
            assert!(planned_files.contains(expected), "missing planned file: {expected}");
        }

        let impact = call_tool(
            "pre_impact",
            json!({ "changes": [{ "path": "shared-props.ts", "symbols": ["SharedButtonProps"] }] }),
            &mut index,
        );
        let impact_payload = tool_payload(&impact);
        assert_eq!(
            impact_payload.pointer("/answer_pack/confidence"),
            Some(&json!("high"))
        );
        assert!(!impact_payload
            .pointer("/answer_pack/missing_evidence")
            .and_then(Value::as_array)
            .unwrap()
            .contains(&json!("module_resolution")));
        let affected_files = impact_payload
            .get("affected_files")
            .and_then(Value::as_array)
            .unwrap();
        assert!(affected_files.contains(&json!("shared-button.tsx")));
        assert!(affected_files.contains(&json!("barrel.ts")));
        assert!(affected_files.contains(&json!("nested-barrel.ts")));
        assert!(affected_files.contains(&json!("dashboard.tsx")));
        assert!(affected_files.contains(&json!("nested-dashboard.tsx")));
        assert!(affected_files.contains(&json!("alias-dashboard.tsx")));
        assert!(!affected_files.contains(&json!("unrelated-collision.tsx")));
        assert!(impact_payload
            .get("affected_references")
            .and_then(Value::as_array)
            .unwrap()
            .iter()
            .any(|reference| reference.get("name") == Some(&json!("SharedButtonProps"))));
    }

    #[test]
    fn tsx_context_surfaces_module_graph_boundary_evidence() {
        let mut index = tsx_fixture_index();

        for (symbol, field, expected, missing) in [
            (
                "MissingValue",
                "unresolved_relative_specifiers",
                "./does-not-exist",
                "module_resolution",
            ),
            (
                "ExternalType",
                "external_module_specifiers",
                "external-package",
                "external_module_resolution",
            ),
            (
                "EscapedValue",
                "blocked_module_specifiers",
                "../../outside-root",
                "blocked_module_path",
            ),
        ] {
            let context = call_tool("pre_context", json!({ "symbol": symbol }), &mut index);
            let payload = tool_payload(&context);
            assert!(payload
                .get(field)
                .and_then(Value::as_array)
                .unwrap()
                .contains(&json!(expected)));
            assert!(payload
                .pointer("/answer_pack/missing_evidence")
                .and_then(Value::as_array)
                .unwrap()
                .contains(&json!(missing)));
            if matches!(symbol, "EscapedValue") {
                assert_eq!(payload.get("definition"), Some(&Value::Null));
            }
        }

        let cycle = call_tool("pre_context", json!({ "symbol": "CycleValue" }), &mut index);
        let cycle_payload = tool_payload(&cycle);
        assert_eq!(cycle_payload.get("module_graph_cycle"), Some(&json!(true)));
        assert_eq!(cycle_payload.get("definition"), Some(&Value::Null));
        assert!(cycle_payload
            .pointer("/answer_pack/missing_evidence")
            .and_then(Value::as_array)
            .unwrap()
            .contains(&json!("module_graph_cycle")));

        let dynamic = call_tool(
            "pre_context",
            json!({ "symbol": "loadDynamicComponent" }),
            &mut index,
        );
        let dynamic_payload = tool_payload(&dynamic);
        assert!(dynamic_payload
            .get("dynamic_import_files")
            .and_then(Value::as_array)
            .unwrap()
            .contains(&json!("dynamic-loader.ts")));
        assert_eq!(
            dynamic_payload.pointer("/answer_pack/confidence"),
            Some(&json!("medium"))
        );

        let plan = call_tool(
            "pre_plan",
            json!({ "task": "inspect missing module", "target_symbols": ["MissingValue"] }),
            &mut index,
        );
        let plan_payload = tool_payload(&plan);
        assert!(plan_payload
            .pointer("/answer_pack/missing_evidence")
            .and_then(Value::as_array)
            .unwrap()
            .contains(&json!("module_resolution")));

        let impact = call_tool(
            "pre_impact",
            json!({ "changes": [{ "path": "blocked-import.ts", "symbols": ["EscapedValue"] }] }),
            &mut index,
        );
        let impact_payload = tool_payload(&impact);
        assert!(impact_payload
            .get("blocked_module_specifiers")
            .and_then(Value::as_array)
            .unwrap()
            .contains(&json!("../../outside-root")));
        assert!(impact_payload
            .pointer("/answer_pack/missing_evidence")
            .and_then(Value::as_array)
            .unwrap()
            .contains(&json!("blocked_module_path")));
        assert_ne!(
            impact_payload.pointer("/answer_pack/confidence"),
            Some(&json!("high"))
        );
    }

    #[test]
    fn unscoped_queries_expose_bounded_snapshot_staleness() {
        let mut index = tsx_fixture_index();
        let context = call_tool("pre_context", json!({ "symbol": "SharedButton" }), &mut index);
        let payload = tool_payload(&context);

        assert_eq!(payload.get("index_consistency"), Some(&json!("bounded_stale")));
        assert_eq!(payload.get("max_staleness_ms"), Some(&json!(500)));
        assert_ne!(
            payload.pointer("/answer_pack/confidence"),
            Some(&json!("high"))
        );
        assert!(payload
            .pointer("/answer_pack/missing_evidence")
            .and_then(Value::as_array)
            .unwrap()
            .contains(&json!("index_snapshot_staleness")));
    }

    #[test]
    fn targeted_context_refreshes_resolved_dependency_files() {
        let root = std::env::temp_dir().join(format!(
            "linghun-tsx-targeted-refresh-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("button.tsx"),
            "export function SharedButton() { return <button />; }\n",
        )
        .unwrap();
        std::fs::write(
            root.join("consumer.tsx"),
            "import { SharedButton } from \"./button\";\nexport const View = () => <SharedButton />;\n",
        )
        .unwrap();

        let mut index = Some(Index::new(root.clone()));
        index.as_mut().unwrap().build();
        let initial = call_tool(
            "pre_context",
            json!({ "symbol": "SharedButton", "path": "consumer.tsx" }),
            &mut index,
        );
        assert!(tool_payload(&initial).get("definition").is_some_and(|value| !value.is_null()));

        std::fs::write(
            root.join("button.tsx"),
            "export function RenamedButton() { return <button />; }\n",
        )
        .unwrap();
        let refreshed = call_tool(
            "pre_context",
            json!({ "symbol": "SharedButton", "path": "consumer.tsx" }),
            &mut index,
        );
        let payload = tool_payload(&refreshed);
        assert_eq!(payload.get("definition"), Some(&Value::Null));
        assert_ne!(
            payload.pointer("/answer_pack/confidence"),
            Some(&json!("high"))
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn targeted_context_refreshes_expanding_barrel_closure() {
        let root = std::env::temp_dir().join(format!(
            "linghun-tsx-barrel-refresh-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("old-button.tsx"),
            "export function SharedButton() { return <button>old</button>; }\n",
        )
        .unwrap();
        std::fs::write(
            root.join("new-button.tsx"),
            "export function Placeholder() { return <button />; }\n",
        )
        .unwrap();
        std::fs::write(
            root.join("barrel.ts"),
            "export { SharedButton } from \"./old-button\";\n",
        )
        .unwrap();
        std::fs::write(
            root.join("consumer.tsx"),
            "import { SharedButton } from \"./barrel\";\nexport const View = () => <SharedButton />;\n",
        )
        .unwrap();

        let mut index = Some(Index::new(root.clone()));
        index.as_mut().unwrap().build();
        std::fs::write(
            root.join("barrel.ts"),
            "export { SharedButton } from \"./new-button\";\n",
        )
        .unwrap();
        std::fs::write(
            root.join("new-button.tsx"),
            "export function SharedButton() { return <button>new</button>; }\n",
        )
        .unwrap();

        let context = call_tool(
            "pre_context",
            json!({ "symbol": "SharedButton", "path": "consumer.tsx" }),
            &mut index,
        );
        let payload = tool_payload(&context);
        assert!(payload
            .pointer("/definition/file")
            .and_then(Value::as_str)
            .is_some_and(|file| file.ends_with("new-button.tsx")));
        assert_eq!(payload.get("index_consistency"), Some(&json!("targeted")));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn typescript_verify_uses_only_program_diagnostics() {
        let root = std::env::temp_dir().join(format!(
            "linghun-ts-verify-single-source-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("verify.ts"),
            "function onlyOne(value: string) { return value; }\nexport const result = onlyOne(\"a\", \"b\");\n",
        )
        .unwrap();

        let mut index = Some(Index::new(root.clone()));
        index.as_mut().unwrap().build();
        let verify = call_tool(
            "pre_verify",
            json!({ "changed_files": ["verify.ts"] }),
            &mut index,
        );
        let payload = tool_payload(&verify);
        let issues = payload.get("issues").and_then(Value::as_array).unwrap();
        assert!(issues.iter().any(|issue| issue.get("code") == Some(&json!("TS2554"))));
        assert!(!issues.iter().any(|issue| {
            issue.get("type") == Some(&json!("argument_count_mismatch"))
                || issue.get("type") == Some(&json!("unresolved_call"))
        }));

        std::fs::remove_dir_all(root).unwrap();
    }

}
