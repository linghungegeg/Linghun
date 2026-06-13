# Capability Runtime / App Bridge Developer Guide

This guide defines the real Local HTTP Connector path for App Bridge. Today, only the `http` transport is a live connector. `mcp`, `plugin`, `desktop_bridge`, and `websocket` remain reserved transport names and must not be described as live app connections.

## User Commands

```text
/apps connect <manifestPath>
/apps validate <manifestPath>
/apps test-run <manifestPath> <capabilityId> <json>
/apps list
/apps doctor
/apps disconnect <appId>
/capabilities run <capabilityId> <json>
```

`/apps connect` reads only the manifest explicitly provided by the user. It does not scan the machine or unrelated directories. After a successful connection, Linghun merges manifest capabilities with remote capabilities and registers them in Capability Runtime.

Developer self-check commands:

- `/apps validate <manifestPath>` validates a project-local manifest without connecting to the app.
- `/apps test-run <manifestPath> <capabilityId> <json>` connects the Local HTTP app, executes one capability, and keeps the app connected for follow-up `/capabilities run` or `/apps disconnect`.

The repository root provides a machine-readable schema: `APP_BRIDGE_MANIFEST.schema.json`. Example connectors live in `app-bridge-examples/node-demo` and `app-bridge-examples/python-demo`.

## Manifest

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

Current implementation requirements:

- `transport` must be `http`.
- `baseUrl` must be loopback HTTP: `http://localhost`, `http://127.0.0.1`, or `http://[::1]`.
- `auth.type` supports `none`, `api_key`, and `local_token`.
- Raw secrets are not allowed in `auth.value`; use `env`, `projectConfigRef`, `userConfigRef`, or `valueRef`.
- `capabilities` must contain at least one capability.

## HTTP Protocol

Handshake:

```http
GET /linghun/capabilities HTTP/1.1
Host: 127.0.0.1:47831
Accept: application/json
Authorization: Bearer <token-if-configured>
```

Execution:

```http
POST /linghun/execute HTTP/1.1
```

Request body:

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

Success response:

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

Keep `summary` and `details` bounded. If the response contains large `output`, `result`, or `data`, Linghun budgets it into an artifact/ref instead of putting raw payloads in the transcript.

## Safety Boundaries

- Connectors cannot bypass Capability Runtime permissions.
- Connectors cannot write evidence directly; Linghun records evidence after execution.
- Capability execution is not verification PASS.
- Do not return raw app state, full logs, full files, large payloads, tokens, cookies, or API keys.
- Do not create background scanners, Computer Use automation, or desktop automation in this protocol.
