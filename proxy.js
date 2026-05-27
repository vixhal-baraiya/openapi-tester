// netlify/functions/proxy.js
// Uses node-fetch which is available in Netlify's Node 18 runtime by default.

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD',
    'Access-Control-Allow-Headers': '*',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  // Parse payload sent by the browser
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Bad JSON: ' + e.message }),
    };
  }

  const { url, method = 'GET', headers = {}, body, isFormData, formFields, formFiles } = payload;

  if (!url) {
    return {
      statusCode: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing url' }),
    };
  }

  // Clean headers — remove ones that break server-to-server requests
  const fwdHeaders = { ...headers };
  delete fwdHeaders['host'];
  delete fwdHeaders['connection'];
  delete fwdHeaders['transfer-encoding'];
  delete fwdHeaders['content-length'];

  // Build fetch options
  const fetchOpts = { method: method.toUpperCase(), headers: fwdHeaders };

  if (['POST', 'PUT', 'PATCH'].includes(fetchOpts.method)) {
    if (isFormData) {
      // Rebuild multipart/form-data from serialized fields + base64 files
      const { FormData, Blob } = await import('node-fetch');
      const fd = new FormData();
      for (const [k, v] of Object.entries(formFields || {})) fd.append(k, v);
      for (const f of (formFiles || [])) {
        const blob = new Blob([Buffer.from(f.base64, 'base64')], { type: f.type || 'application/octet-stream' });
        fd.append(f.field, blob, f.name);
      }
      fetchOpts.body = fd;
      // Let node-fetch set Content-Type with boundary automatically
      delete fetchOpts.headers['content-type'];
      delete fetchOpts.headers['Content-Type'];
    } else if (body !== null && body !== undefined) {
      fetchOpts.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
  }

  try {
    const { default: fetch } = await import('node-fetch');
    const resp = await fetch(url, fetchOpts);

    const contentType = resp.headers.get('content-type') || '';
    const isText = contentType.includes('json') || contentType.includes('text') || contentType.includes('xml');

    // Convert headers to plain object
    const respHeaders = {};
    resp.headers.forEach((v, k) => { respHeaders[k] = v; });

    const result = {
      status: resp.status,
      statusText: resp.statusText,
      headers: respHeaders,
      body: null,
      bodyBase64: null,
    };

    if (isText) {
      result.body = await resp.text();
    } else {
      const buf = await resp.buffer();
      result.bodyBase64 = buf.toString('base64');
    }

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };

  } catch (e) {
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Proxy failed: ' + e.message, status: null }),
    };
  }
};
