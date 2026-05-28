// proxy.js
// Local development proxy for OpenAPI Tester. Zero dependencies.

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD",
  "Access-Control-Allow-Headers": "*",
};

function getPort() {
  const arg = process.argv.find((a) => a.startsWith("--port="));
  const val = arg ? arg.split("=")[1] : process.env.PORT;
  const port = Number(val || 3131);
  return Number.isFinite(port) && port > 0 ? port : 3131;
}

function send(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, { ...CORS, ...headers });
  res.end(body);
}

function sendJson(res, statusCode, payload) {
  send(res, statusCode, JSON.stringify(payload), { "Content-Type": "application/json" });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function stripUnsafeHeaders(headers = {}) {
  const cleaned = {};
  const blocked = new Set([
    "host",
    "connection",
    "transfer-encoding",
    "content-length",
  ]);

  for (const [k, v] of Object.entries(headers || {})) {
    const lower = String(k).toLowerCase();
    if (blocked.has(lower)) continue;
    // The proxy must set the multipart boundary itself.
    if (lower === "content-type" && /multipart\/form-data/i.test(String(v))) continue;
    cleaned[k] = v;
  }
  return cleaned;
}

function escapeHeaderValue(value) {
  return String(value ?? "").replace(/["\r\n]/g, "_");
}

function pushFormField(parts, boundary, name, value) {
  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${escapeHeaderValue(name)}"\r\n\r\n` +
    `${value ?? ""}\r\n`
  ));
}

function pushFormFile(parts, boundary, file) {
  const filename = file.name || "upload.bin";
  const type = file.type || "application/octet-stream";

  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${escapeHeaderValue(file.field)}"; filename="${escapeHeaderValue(filename)}"\r\n` +
    `Content-Type: ${escapeHeaderValue(type)}\r\n\r\n`
  ));
  parts.push(Buffer.from(file.base64 || "", "base64"));
  parts.push(Buffer.from("\r\n"));
}

function buildMultipartBody(formFields = {}, formFiles = []) {
  const boundary = "OpenApiTesterBoundary" + Date.now().toString(16) + Math.random().toString(16).slice(2);
  const parts = [];

  if (Array.isArray(formFields)) {
    for (const field of formFields) pushFormField(parts, boundary, field.name ?? field.field, field.value);
  } else {
    for (const [name, value] of Object.entries(formFields || {})) {
      if (Array.isArray(value)) {
        for (const item of value) pushFormField(parts, boundary, name, item);
      } else {
        pushFormField(parts, boundary, name, value);
      }
    }
  }

  for (const file of formFiles || []) pushFormFile(parts, boundary, file);
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function forwardRequest(payload) {
  return new Promise((resolve, reject) => {
    const target = new URL(payload.url);
    const method = String(payload.method || "GET").toUpperCase();
    const headers = stripUnsafeHeaders(payload.headers || {});
    let requestBody = null;

    if (!["GET", "HEAD"].includes(method)) {
      if (payload.isFormData) {
        const multipart = buildMultipartBody(payload.formFields, payload.formFiles);
        requestBody = multipart.body;
        headers["Content-Type"] = multipart.contentType;
      } else if (payload.body != null) {
        requestBody = typeof payload.body === "string" ? payload.body : JSON.stringify(payload.body);
      }
    }

    if (requestBody != null) headers["Content-Length"] = Buffer.byteLength(requestBody);

    const client = target.protocol === "https:" ? https : http;
    const req = client.request(
      target,
      { method, headers },
      (resp) => {
        const chunks = [];
        resp.on("data", (chunk) => chunks.push(chunk));
        resp.on("error", reject);
        resp.on("end", () => {
          resolve({
            status: resp.statusCode || 0,
            statusText: resp.statusMessage || "",
            headers: resp.headers || {},
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );

    req.on("error", reject);
    if (requestBody != null) req.write(requestBody);
    req.end();
  });
}

async function handleProxy(req, res) {
  let payload;
  try {
    payload = JSON.parse((await readRequestBody(req)) || "{}");
  } catch (e) {
    sendJson(res, 200, { error: "Bad request body: " + e.message, status: null });
    return;
  }

  if (!payload.url) {
    sendJson(res, 200, { error: "Missing 'url' in payload", status: null });
    return;
  }

  try {
    sendJson(res, 200, await forwardRequest(payload));
  } catch (e) {
    sendJson(res, 200, { error: "Fetch failed: " + e.message, status: null });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    send(res, 204, "");
    return;
  }

  const reqUrl = new URL(req.url, "http://localhost");
  if (reqUrl.pathname === "/proxy") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed. Use POST." });
      return;
    }
    await handleProxy(req, res);
    return;
  }

  if (req.method === "GET" && (reqUrl.pathname === "/" || reqUrl.pathname === "/index.html")) {
    const indexPath = path.join(__dirname, "index.html");
    try {
      send(res, 200, fs.readFileSync(indexPath, "utf8"), { "Content-Type": "text/html; charset=utf-8" });
    } catch (e) {
      sendJson(res, 500, { error: "Could not read index.html: " + e.message });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

const port = getPort();
server.listen(port, () => {
  console.log(`OpenAPI Tester running at http://localhost:${port}`);
});
