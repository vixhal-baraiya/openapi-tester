// upload-fix.js
// Runtime patch for file-upload fields that are declared as Swagger/OpenAPI 2
// `in: formData, type: file`, and for multipart OpenAPI 3 fields that are
// arrays of file-like schemas. The main app already supports basic OpenAPI 3
// multipart request bodies; this widens file-field detection so upload controls
// are shown instead of a raw [] textarea.
(function () {
  function resolveMaybeRef(obj, spec) {
    if (!obj) return {};
    if (obj.$ref && typeof window.resolveRef === 'function') return window.resolveRef(obj.$ref, spec) || obj;
    return obj;
  }

  function resolveSchemaDeep(schema, spec, depth) {
    if (!schema || depth > 8) return schema || {};
    let resolved = resolveMaybeRef(schema, spec) || schema;

    if (typeof window.resolveSchema === 'function') {
      resolved = window.resolveSchema(resolved, spec) || resolved;
    }

    if (resolved.items) {
      resolved = { ...resolved, items: resolveSchemaDeep(resolved.items, spec, depth + 1) };
    }

    return resolved;
  }

  function normalizeParamSchema(param, spec) {
    const base = resolveSchemaDeep(param.schema, spec, 0) || {};
    const schema = { ...base };
    for (const key of ['type', 'format', 'items', 'enum', 'default', 'minimum', 'maximum', 'example', 'description', 'contentEncoding', 'contentMediaType']) {
      if (schema[key] === undefined && param[key] !== undefined) schema[key] = param[key];
    }
    if (schema.items) schema.items = resolveSchemaDeep(schema.items, spec, 0) || schema.items;
    return schema;
  }

  function fieldNameTokens(name) {
    return String(name || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  function isMetadataField(name) {
    const tokens = fieldNameTokens(name);
    return tokens.includes('metadata')
      || tokens.includes('meta')
      || tokens.includes('filemetadata')
      || tokens.includes('filemeta')
      || tokens.includes('documentmetadata')
      || tokens.includes('documentmeta');
  }

  function looksLikeUploadField(name, schema) {
    if (isMetadataField(name)) return false;

    const tokens = fieldNameTokens(name);
    const d = String(schema && schema.description || '').toLowerCase();

    // Name fallback is intentionally strict to avoid false positives like
    // `file_metadata`. It should catch fields actually named files/documents/etc.
    const uploadName = tokens.length > 0 && tokens.every(t =>
      ['file', 'files', 'document', 'documents', 'attachment', 'attachments', 'upload', 'uploads'].includes(t)
    );

    const uploadDescription = /\b(files?|documents?|attachments?)\s+to\s+upload\b/.test(d)
      || /\bupload(ed)?\s+(files?|documents?|attachments?)\b/.test(d);

    return uploadName || uploadDescription;
  }

  function isFileLikeSchema(schema, spec, fieldName, inForm) {
    const sc = resolveSchemaDeep(schema, spec, 0);
    if (!sc) return false;

    if (sc.type === 'file') return true;
    if (sc.format === 'binary') return true;
    if (sc.type === 'string' && sc.format === 'binary') return true;

    if (sc.type === 'array') {
      if (isFileLikeSchema(sc.items || {}, spec, fieldName, inForm)) return true;
      // Some generators omit `items.format: binary` even for multipart file arrays.
      // Only use this strict name/description fallback for multipart/formData fields.
      if (inForm && looksLikeUploadField(fieldName, sc)) return true;
    }

    // Same strict fallback for a single multipart/formData string field named file/files.
    if (inForm && sc.type === 'string' && looksLikeUploadField(fieldName, sc)) return true;
    return false;
  }

  function isMultiFileSchema(schema, spec, fieldName, inForm) {
    const sc = resolveSchemaDeep(schema, spec, 0);
    return sc && sc.type === 'array' && isFileLikeSchema(sc.items || sc, spec, fieldName, inForm);
  }

  function pushOpenApi3BodyParams(params, body, spec) {
    const content = body.content || {};
    const isForm = !!content['multipart/form-data'];
    const ct = content['multipart/form-data'] || content['application/json'] || Object.values(content)[0];
    if (!ct) return;

    const schema = resolveSchemaDeep(ct.schema || {}, spec, 0);
    const props = schema && schema.properties ? schema.properties : {};
    const required = schema && schema.required ? schema.required : [];

    if (Object.keys(props).length) {
      for (const [key, rawProp] of Object.entries(props)) {
        const prop = resolveSchemaDeep(rawProp, spec, 0);
        if (isFileLikeSchema(prop, spec, key, isForm)) {
          params.push({
            k: key,
            loc: 'body',
            label: key,
            req: required.includes(key),
            desc: prop && prop.description ? prop.description : '',
            type: isMultiFileSchema(prop, spec, key, isForm) ? 'file-multi' : 'file',
            isForm: true,
          });
        } else {
          const inferred = typeof window.inferType === 'function' ? window.inferType(prop, key) : { type: 'text', default: '' };
          params.push({
            k: key,
            loc: 'body',
            label: key,
            req: required.includes(key),
            desc: prop && prop.description ? prop.description : '',
            isForm,
            ...inferred,
          });
        }
      }
    } else if (schema) {
      params.push({ k: '_body', loc: 'body', label: 'Request body', req: true, type: 'textarea', desc: '', default: '{}' });
    }
  }

  window.buildParams = function buildParams(path, method, op, spec) {
    const params = [];

    for (const raw of (op.parameters || [])) {
      const param = resolveMaybeRef(raw, spec);
      const schema = normalizeParamSchema(param, spec);
      const desc = param.description || schema.description || '';
      const required = !!param.required;

      // Swagger/OpenAPI 2 file uploads are declared as parameters:
      // { in: 'formData', type: 'file', name: '...' }
      if (param.in === 'formData') {
        if (isFileLikeSchema(schema, spec, param.name, true)) {
          params.push({
            k: param.name,
            loc: 'body',
            label: param.name,
            req: required,
            desc,
            type: isMultiFileSchema(schema, spec, param.name, true) ? 'file-multi' : 'file',
            isForm: true,
          });
        } else {
          const inferred = typeof window.inferType === 'function' ? window.inferType(schema, param.name) : { type: 'text', default: '' };
          params.push({
            k: param.name,
            loc: 'body',
            label: param.name,
            req: required,
            desc,
            isForm: true,
            ...inferred,
          });
        }
        continue;
      }

      const inferred = typeof window.inferType === 'function' ? window.inferType(schema, param.name) : { type: 'text', default: '' };
      params.push({
        k: param.name,
        loc: param.in,
        label: param.name,
        req: required,
        desc,
        ...inferred,
      });
    }

    if (op.requestBody) pushOpenApi3BodyParams(params, op.requestBody, spec);
    return params;
  };
})();
