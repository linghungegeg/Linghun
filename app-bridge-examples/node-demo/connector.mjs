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
    supportsPreview: false,
  },
];

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
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
      details: "Demo connector returned bounded details.",
    });
    return;
  }
  send(res, 404, { ok: false, summary: "Not found." });
});

server.listen(port, host, () => {
  console.log(`Demo connector listening on http://${host}:${port}`);
});
