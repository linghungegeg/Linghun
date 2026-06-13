from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os

HOST = "127.0.0.1"
PORT = int(os.environ.get("LINGHUN_DEMO_CONNECTOR_PORT", "47832"))

CAPABILITIES = [
    {
        "id": "demo.notes.summarize",
        "appId": "demo.notes",
        "title": "Summarize Note",
        "description": "Summarizes a local note.",
        "category": "notes",
        "intents": ["summarize note"],
        "keywords": ["note", "summarize"],
        "transport": "http",
        "auth": "none",
        "permission": "read",
        "riskLevel": "low",
        "inputSchema": {"type": "object", "required": ["text"]},
        "outputSchema": {"type": "object", "required": ["summary"]},
        "supportsRollback": False,
        "supportsPreview": False,
    }
]


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/linghun/capabilities":
            self._send(200, {"capabilities": CAPABILITIES})
            return
        self._send(404, {"ok": False, "summary": "Not found."})

    def do_POST(self):
        if self.path != "/linghun/execute":
            self._send(404, {"ok": False, "summary": "Not found."})
            return
        raw = self.rfile.read(int(self.headers.get("content-length", "0") or "0"))
        request = json.loads(raw.decode("utf-8") or "{}")
        if request.get("capabilityId") != "demo.notes.summarize":
            self._send(404, {"ok": False, "summary": "Capability not found."})
            return
        text = str(request.get("input", {}).get("text", "")).strip()
        self._send(200, {"ok": True, "summary": f"Summarized {len(text)} chars."})


HTTPServer((HOST, PORT), Handler).serve_forever()
