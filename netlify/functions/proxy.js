// netlify/functions/proxy.js
// Uses built-in fetch (Node 18+). Zero dependencies.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD",
  "Access-Control-Allow-Headers": "*",
};

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

  const init = {
    method: String(method || "GET").toUpperCase(),
    headers: stripUnsafeHeaders(headers),
  };

  if (!["GET", "HEAD"].includes(init.method)) {
    if (isFormData) {
      const multipart = buildMultipartBody(formFields, formFiles);
      init.body = multipart.body;
      init.headers["Content-Type"] = multipart.contentType;
    } else if (body != null) {
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }
  }

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

  let responseBody = "";
  try {
    responseBody = await response.text();
  } catch (e) {
    responseBody = "";
  }

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
