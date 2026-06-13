# Capability Runtime / App Bridge 开发者指南

本文定义 Phase 7.15 的真实 Local HTTP Connector 接入方式。当前只有 `http` transport 完成真连接；`mcp`、`plugin`、`desktop_bridge`、`websocket` 仍是预留类型，不代表已完成真实 app 连接。

## 用户入口

```text
/apps connect <manifestPath>
/apps validate <manifestPath>
/apps test-run <manifestPath> <capabilityId> <json>
/apps list
/apps doctor
/apps disconnect <appId>
/capabilities run <capabilityId> <json>
```

`/apps connect` 只读取用户显式传入的本地 manifest，不做后台扫描，不读取无关目录。连接成功后，manifest 与远端发现到的 capabilities 会注册进 Capability Runtime，后续统一通过 `/capabilities run` 执行。

HTTP connector capabilities 按当前项目隔离：一个项目通过 `/apps connect` 注册的 capability，不会出现在另一个项目的 `/capabilities list`、`/capabilities doctor` 或 `/capabilities run` 中。内置 mock capabilities 仍是全局可见。

开发者自检入口：

- `/apps validate <manifestPath>`：只校验当前项目内 manifest，不连接外部 app。
- `/apps test-run <manifestPath> <capabilityId> <json>`：连接 manifest 指向的 Local HTTP app，执行一次 capability，并保留 connected 状态，便于继续 `/capabilities run` 或 `/apps disconnect`。

根目录提供机器可读 schema：`APP_BRIDGE_MANIFEST.schema.json`。示例 connector 位于 `app-bridge-examples/node-demo` 和 `app-bridge-examples/python-demo`。

## Manifest

Manifest 必须是一个简单 JSON 对象：

```json
{
  "appId": "demo.drawing",
  "name": "Demo Drawing",
  "version": "0.1.0",
  "transport": "http",
  "baseUrl": "http://127.0.0.1:47831",
  "auth": { "type": "none" },
  "capabilities": [
    {
      "id": "demo.drawing.describe",
      "appId": "demo.drawing",
      "title": "Describe Drawing",
      "description": "Describes a local drawing.",
      "category": "drawing",
      "intents": ["describe drawing"],
      "keywords": ["drawing", "describe"],
      "transport": "http",
      "auth": "none",
      "permission": "read",
      "riskLevel": "low",
      "inputSchema": { "type": "object", "required": ["subject"] },
      "outputSchema": { "type": "object", "required": ["summary"] },
      "supportsRollback": false,
      "supportsPreview": false
    }
  ]
}
```

当前实现要求：

- `transport` 必须是 `http` 才会真连接。
- `baseUrl` 必须是 loopback `http://localhost`、`http://127.0.0.1` 或 `http://[::1]`。
- `auth.type` 支持 `none`、`api_key`、`local_token`。
- `auth.value` 不允许写 raw secret；只能用 `env`、`projectConfigRef`、`userConfigRef` 这类 ref。
- `capabilities` 至少包含一个 capability，远端 `GET /linghun/capabilities` 返回的同 id capability 会覆盖 manifest 中的 metadata。

## HTTP 协议

连接时 Linghun 发起：

```http
GET /linghun/capabilities HTTP/1.1
Host: 127.0.0.1:47831
Accept: application/json
Authorization: Bearer <token-if-configured>
```

响应可以直接是数组，也可以是 `{ "capabilities": [...] }`：

```json
{
  "capabilities": [
    {
      "id": "demo.drawing.describe",
      "appId": "demo.drawing",
      "title": "Describe Drawing",
      "description": "Describes a local drawing.",
      "category": "drawing",
      "intents": ["describe drawing"],
      "keywords": ["drawing", "describe"],
      "transport": "http",
      "auth": "none",
      "permission": "read",
      "riskLevel": "low",
      "inputSchema": { "type": "object", "required": ["subject"] },
      "outputSchema": { "type": "object", "required": ["summary"] },
      "supportsRollback": false,
      "supportsPreview": false
    }
  ]
}
```

执行时 Linghun 发起：

```json
{
  "capabilityId": "demo.drawing.describe",
  "input": { "subject": "circle" },
  "metadata": {
    "requestId": "generated-uuid",
    "source": "slash",
    "appId": "demo.drawing"
  }
}
```

成功响应：

```json
{
  "ok": true,
  "summary": "Described circle.",
  "details": "Bounded details for humans.",
  "artifactRef": "optional-ref",
  "previewRef": "optional-preview-ref",
  "rollbackRef": "optional-rollback-ref"
}
```

`summary` 和 `details` 应保持有界。若返回 `output`、`result` 或 `data` 且内容过大，Linghun 会把它 budget 成 artifact/ref，不把 raw payload 放进 transcript。

## Auth Ref

示例：

```json
{
  "auth": {
    "type": "api_key",
    "env": "LINGHUN_DEMO_DRAWING_KEY"
  }
}
```

```powershell
$env:LINGHUN_DEMO_DRAWING_KEY = "dev-local-token"
```

解析优先级：

1. shell env
2. project config ref
3. user config ref
4. manifest value ref，例如 `env:LINGHUN_DEMO_DRAWING_KEY` 或 `settings.providers.demo.apiKey`

当前实现支持 env、`settings.*` config ref 和 manifest `valueRef` 读取；raw key/token 不进入模型、transcript、evidence 或 doctor。`/apps doctor` 只显示 `authSource`，不显示 value。

## 最小 Node.js Demo

```js
import http from "node:http";

const host = "127.0.0.1";
const port = Number(process.env.LINGHUN_DEMO_CONNECTOR_PORT ?? 47831);

const capabilities = [
  {
    id: "demo.drawing.describe",
    appId: "demo.drawing",
    title: "Describe Drawing",
    description: "Describes a local drawing.",
    category: "drawing",
    intents: ["describe drawing"],
    keywords: ["drawing", "describe"],
    transport: "http",
    auth: "none",
    permission: "read",
    riskLevel: "low",
    inputSchema: { type: "object", required: ["subject"] },
    outputSchema: { type: "object", required: ["summary"] },
    supportsRollback: false,
    supportsPreview: false
  }
];

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function readJson(req) {
  let body = "";
  req.setEncoding("utf8");
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${host}:${port}`);
  if (req.method === "GET" && url.pathname === "/linghun/capabilities") {
    send(res, 200, { capabilities });
    return;
  }
  if (req.method === "POST" && url.pathname === "/linghun/execute") {
    const request = await readJson(req);
    if (request.capabilityId !== "demo.drawing.describe") {
      send(res, 404, { ok: false, summary: "Capability not found." });
      return;
    }
    const subject = String(request.input?.subject ?? "").trim();
    send(res, 200, {
      ok: true,
      summary: `Described ${subject || "untitled"}.`,
      details: "Demo connector returned bounded details."
    });
    return;
  }
  send(res, 404, { ok: false, summary: "Not found." });
});

server.listen(port, host, () => {
  console.log(`Demo connector listening on http://${host}:${port}`);
});
```

## 安全边界

- Connector 不能绕过 Capability Runtime 的 permission pipeline。
- Connector 不能直接写 evidence；evidence 由 Capability Runtime 在执行后记录。
- Capability execution 不等于 verification PASS。
- 成功调用会记录 `capability succeeded` 和 `capability_success`；失败调用会记录 `capability failed` 和 `capability_failure`，不会记录成 completed。
- 不返回 raw app state、完整日志、完整文件、大 payload、token、cookie 或 API key。
- 不创建后台常驻扫描器，不做 Computer Use，不做桌面自动化。
- 非 HTTP transport 本阶段仍为预留，不要写成已真连接。
