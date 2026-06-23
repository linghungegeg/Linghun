# pre-engine Phase 2 交接稿

## Phase 1 完成状态（commit 336ba02e）

### 已交付能力
- **MCP JSON-RPC 2.0 stdio 服务器**，支持 `initialize` / `tools/list` / `tools/call`
- **`pre_context` 工具**：查询任意符号的 definition / references / callees / callers / signature
- **6 语言 tree-sitter 解析**：TypeScript、TSX、Rust、Python、Go、Java
- **并行解析**：rayon par_iter，每线程独立 Parser（Parser 不 Send）
- **增量刷新**：mtime 比对，仅重新解析变更文件，已删除文件自动移除
- **路径段目录过滤**：16 个常见缓存/构建/依赖目录（node_modules、.git、target、dist 等）

### 性能基线（Linghun 全仓，Windows）
| 指标 | 值 |
|------|------|
| 冷启动 build | ~2.4s |
| 无变更 refresh | ~0.4s |
| tools/src 子目录冷启动 | ~0.37s |

### 文件结构
```
src/
  main.rs      — MCP 服务器 + JSON-RPC 分发 + tool handler
  index.rs     — WalkDir 收集 + rayon 并行解析 + mtime refresh + is_ignored
  language.rs  — Lang enum + 扩展名映射 + tree_sitter_language()
  symbols.rs   — 定义提取 / 引用搜索 / callees / callers（全语言）
```

### 构建环境
```powershell
$env:PATH = "C:\w64devkit\bin;$env:PATH"
$env:CC = "gcc"; $env:CXX = "g++"
$env:LIBRARY_PATH = "C:\w64devkit\lib"
cargo +stable-x86_64-pc-windows-gnu build --release
```

### 调用方式
stdio JSON-RPC，一行一条 JSON。示例：
```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"rootUri":"F:/Linghun"}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"pre_context","arguments":{"symbol":"executeModelToolUse"}}}
```
注意：Windows 路径用正斜杠。

---

## Phase 2 目标：pre_impact 实装

### 当前状态
`pre_impact` 工具已注册（main.rs:233），返回 placeholder。

### 输入 schema（已定义）
```json
{
  "changes": [
    { "path": "string", "symbols": ["string"] }
  ]
}
```

### 期望输出
给定变更的文件/符号列表，返回：
1. **受影响文件**：通过 import/caller 链传播
2. **受影响函数**：直接和间接 caller
3. **关联测试文件**：启发式匹配（`*.test.ts`、`*.spec.ts`、同名测试）

### 实现路径建议
1. **构建符号→文件反向索引**：symbols.rs 已有 `extract_definitions`，遍历全部文件建 `HashMap<String, Vec<PathBuf>>`
2. **传播算法**：从 changed symbols 出发，沿 caller 链 BFS/DFS 到指定深度（默认 2-3 层）
3. **测试文件关联**：文件名匹配 + import 关系
4. **结果格式**：返回 `{ affected_files, affected_functions, related_tests }`

### 不做（Phase 2 边界）
- 不做 daemon / 长驻进程
- 不做磁盘持久化缓存
- 不做 pre_plan / pre_verify 实装（Phase 3）
- 不改 MCP 协议层

---

## Phase 3 预留：pre_plan + pre_verify

- **pre_plan**：基于 pre_impact 结果 + 依赖拓扑，输出确定性编辑顺序
- **pre_verify**：变更后快速预检 import/export/签名一致性（轻量 lint）

---

## 技术约束备忘
- tree-sitter `Parser` 不是 Send/Sync，并行必须每线程 new
- `Tree` 是 Send，解析结果可安全跨线程移动
- Windows 路径在 JSON-RPC 中用正斜杠传入，内部 PathBuf 自动处理
- rayon 默认线程池（CPU 核心数），无需手动配置
- 当前 symbols.rs 的 caller/callee 提取是单文件内的，跨文件关联需在 tool handler 层聚合
