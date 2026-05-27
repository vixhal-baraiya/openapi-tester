// netlify/functions/proxy.js
// Netlify serverless function — forwards any request to the target API.
// Called by the browser as: POST /.netlify/functions/proxy
// Body: { url, method, headers, body }

const https = require('https');
const http  = require('http');

exports.handler = async (event) => {
  // Allow preflight
  const corsHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers':'*',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  // Parse the incoming request from the browser
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON payload: ' + e.message }),
    };
  }

  const { url: targetUrl, method = 'GET', headers = {}, body, isFormData, formFields, formFiles } = payload;

  if (!targetUrl) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing target url' }),
    };
  }

  let targetParsed;
  try {
    targetParsed = new URL(targetUrl);
  } catch (e) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid target URL: ' + targetUrl }),
    };
  }

  // Build the request body buffer
  let bodyBuffer = null;
  let requestHeaders = { ...headers };

  if (isFormData && formFields) {
    // Rebuild multipart/form-data from serialized fields
    const boundary = '----NetlifyProxyBoundary' + Date.now();
    const parts = [];

    // Regular fields
    for (const [key, value] of Object.entries(formFields || {})) {
      parts.push(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
        `${value}`
      );
    }

    // File fields (base64 encoded)
    for (const file of (formFiles || [])) {
      parts.push(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${file.field}"; filename="${file.name}"\r\n` +
        `Content-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`
      );
      // Note: binary files need special handling — append as buffer
    }

    const body = parts.join('\r\n') + `\r\n--${boundary}--`;
    bodyBuffer = Buffer.from(body, 'utf-8');
    requestHeaders['content-type'] = `multipart/form-data; boundary=${boundary}`;
    requestHeaders['content-length'] = bodyBuffer.length;
  } else if (body) {
    bodyBuffer = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf-8');
    requestHeaders['content-length'] = bodyBuffer.length;
  }

  // Strip hop-by-hop headers
  delete requestHeaders['host'];
  delete requestHeaders['connection'];
  delete requestHeaders['transfer-encoding'];
  delete requestHeaders['content-length']; // will be set correctly below
  if (bodyBuffer) requestHeaders['content-length'] = bodyBuffer.length;

  const isHttps = targetParsed.protocol === 'https:';
  const lib = isHttps ? https : http;

  return new Promise((resolve) => {
    const options = {
      hostname: targetParsed.hostname,
      port:     targetParsed.port || (isHttps ? 443 : 80),
      path:     targetParsed.pathname + targetParsed.search,
      method:   method.toUpperCase(),
      headers:  requestHeaders,
    };

    const req = lib.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const contentType = res.headers['content-type'] || '';
        const isText = contentType.includes('json') || contentType.includes('text') || contentType.includes('xml');

        resolve({
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status:      res.statusCode,
            statusText:  res.statusMessage,
            headers:     res.headers,
            body:        isText ? buf.toString('utf-8') : null,
            bodyBase64:  isText ? null : buf.toString('base64'),
          }),
        });
      });
    });

    req.on('error', (e) => {
      resolve({
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error:  'Proxy request failed: ' + e.message,
          status: null,
        }),
      });
    });

    if (bodyBuffer) req.write(bodyBuffer);
    req.end();
  });
};
