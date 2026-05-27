const https = require("https");
const http = require("http");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD",
  "Access-Control-Allow-Headers": "*",
};

function ok(data) {
  return {
    statusCode: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
}

function err(msg) {
  return {
    statusCode: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: JSON.stringify({ error: msg, status: null }),
  };
}

function buildMultipart(formFields, formFiles) {
  const boundary = "Boundary" + Date.now();
  const parts = [];

  for (const [k, v] of Object.entries(formFields || {})) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`
      )
    );
  }

  for (const f of formFiles || []) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.name}"\r\nContent-Type: ${f.type || "application/octet-stream"}\r\n\r\n`
      )
    );
    parts.push(Buffer.from(f.base64, "base64"));
    parts.push(Buffer.from("\r\n"));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return err("Could not parse request body: " + e.message);
  }

  const { url, method = "GET", headers = {}, body, isFormData, formFields, formFiles } = payload;

  if (!url) return err("Missing url in payload");

  // Build body buffer
  let bodyBuf = null;
  const reqHeaders = { ...headers };
  delete reqHeaders["host"];
  delete reqHeaders["connection"];
  delete reqHeaders["transfer-encoding"];
  delete reqHeaders["content-length"];

  if (["POST", "PUT", "PATCH"].includes(method.toUpperCase())) {
    if (isFormData) {
      const { body: fb, contentType } = buildMultipart(formFields, formFiles);
      bodyBuf = fb;
      reqHeaders["content-type"] = contentType;
    } else if (body != null) {
      const s = typeof body === "string" ? body : JSON.stringify(body);
      bodyBuf = Buffer.from(s, "utf-8");
    }
  }

  if (bodyBuf) reqHeaders["content-length"] = String(bodyBuf.length);

  // Parse target URL
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return err("Invalid URL: " + url);
  }

  const lib = parsed.protocol === "https:" ? https : http;

  return new Promise((resolve) => {
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: method.toUpperCase(),
      headers: reqHeaders,
    };

    const req = lib.request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const ct = res.headers["content-type"] || "";
        const isText =
          ct.includes("json") ||
          ct.includes("text") ||
          ct.includes("xml") ||
          buf.length === 0;

        // Sanitize response headers — remove ones that cause issues
        const respHeaders = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (!["transfer-encoding", "connection", "keep-alive"].includes(k)) {
            respHeaders[k] = v;
          }
        }

        resolve(
          ok({
            status: res.statusCode,
            statusText: res.statusMessage,
            headers: respHeaders,
            body: isText ? buf.toString("utf-8") : null,
            bodyBase64: isText ? null : buf.toString("base64"),
          })
        );
      });

      res.on("error", (e) => resolve(err("Response error: " + e.message)));
    });

    req.on("error", (e) => resolve(err("Request error: " + e.message)));
    req.setTimeout(25000, () => {
      req.destroy();
      resolve(err("Request timed out after 25s"));
    });

    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
};
