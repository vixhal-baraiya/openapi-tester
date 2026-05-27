// netlify/functions/proxy.js
// Uses built-in fetch (Node 18+). Zero dependencies.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD",
  "Access-Control-Allow-Headers": "*",
};

exports.handler = async (event) => {
  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  // Only accept POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed. Use POST." }),
    };
  }

  // Parse payload
  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Bad request body: " + e.message, status: null }),
    };
  }

  const {
    url,
    method = "GET",
    headers = {},
    body,
    isFormData,
    formFields,
    formFiles,
  } = payload;

  if (!url) {
    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing 'url' in payload", status: null }),
    };
  }

  // Clean up headers
  const fwdHeaders = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (["host", "connection", "transfer-encoding", "content-length"].includes(lower)) continue;
    fwdHeaders[k] = v;
  }

  // Build fetch init
  const init = { method: method.toUpperCase(), headers: fwdHeaders };

  if (["POST", "PUT", "PATCH"].includes(init.method)) {
    if (isFormData) {
      // Rebuild multipart manually using Buffer — Node 18 FormData doesn't work well in Lambda
      const boundary = "Boundary" + Date.now();
      const parts = [];

      for (const [k, v] of Object.entries(formFields || {})) {
        parts.push(
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)
        );
      }
      for (const f of formFiles || []) {
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.name}"\r\nContent-Type: ${f.type || "application/octet-stream"}\r\n\r\n`));
        parts.push(Buffer.from(f.base64, "base64"));
        parts.push(Buffer.from("\r\n"));
      }
      parts.push(Buffer.from(`--${boundary}--\r\n`));

      const bodyBuf = Buffer.concat(parts);
      init.body = bodyBuf;
      init.headers["content-type"] = `multipart/form-data; boundary=${boundary}`;
      delete init.headers["Content-Type"];
    } else if (body != null) {
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }
  }

  // Make the request using global fetch (Node 18)
  let response;
  try {
    response = await fetch(url, init);
  } catch (e) {
    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Fetch failed: " + e.message, status: null }),
    };
  }

  // Read response
  let responseBody = "";
  try {
    responseBody = await response.text();
  } catch (e) {
    responseBody = "";
  }

  // Collect response headers
  const respHeaders = {};
  response.headers.forEach((v, k) => {
    respHeaders[k] = v;
  });

  return {
    statusCode: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: JSON.stringify({
      status: response.status,
      statusText: response.statusText,
      headers: respHeaders,
      body: responseBody,
    }),
  };
};
