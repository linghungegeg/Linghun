use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};

fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut stdout_lock = stdout.lock();

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
        if let Some(response) = handle_request(&request) {
            let out = serde_json::to_string(&response).unwrap();
            writeln!(stdout_lock, "{}", out).ok();
            stdout_lock.flush().ok();
        }
    }
}

fn handle_request(request: &Value) -> Option<Value> {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let method = request.get("method").and_then(|m| m.as_str()).unwrap_or("");

    match method {
        "initialize" => Some(json_rpc_result(id, json!({
            "protocolVersion": "2025-06-18",
            "capabilities": {
                "tools": {}
            },
            "serverInfo": {
                "name": "linghun-pre-engine",
                "version": "0.1.0"
            }
        }))),
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
            let result = handle_tool_call(tool_name, &arguments);
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

fn handle_tool_call(tool_name: &str, arguments: &Value) -> Value {
    match tool_name {
        "pre_context" => {
            let symbol = arguments.get("symbol").and_then(|s| s.as_str()).unwrap_or("");
            json!({
                "content": [{
                    "type": "text",
                    "text": format!("[pre_context] placeholder — symbol: {}", symbol)
                }]
            })
        }
        "pre_impact" => {
            json!({
                "content": [{
                    "type": "text",
                    "text": "[pre_impact] placeholder — no AST engine yet"
                }]
            })
        }
        "pre_plan" => {
            let task = arguments.get("task").and_then(|s| s.as_str()).unwrap_or("");
            json!({
                "content": [{
                    "type": "text",
                    "text": format!("[pre_plan] placeholder — task: {}", task)
                }]
            })
        }
        "pre_verify" => {
            json!({
                "content": [{
                    "type": "text",
                    "text": "[pre_verify] placeholder — no AST engine yet"
                }]
            })
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
