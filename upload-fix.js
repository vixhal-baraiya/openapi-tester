// upload-fix.js
// Runtime patch for file-upload fields that are declared as Swagger/OpenAPI 2
// `in: formData, type: file`. The main app already supports OpenAPI 3
// multipart request bodies; this adds the missing Swagger 2 field mapping.
(function () {
  function resolveMaybeRef(obj, spec) {
    if (!obj) return {};
    if (obj.$ref && typeof window.resolveRef === 'function') return window.resolveRef(obj.$ref, spec) || obj;
    return obj;
  }

  function normalizeParamSchema(param, spec) {
    const base = resolveMaybeRef(param.schema, spec) || {};
    const schema = { ...base };
    for (const key of ['type', 'format', 'items', 'enum', 'default', 'minimum', 'maximum', 'example', 'description']) {
      if (schema[key] === undefined && param[key] !== undefined) schema[key] = param[key];
    }
    if (schema.items) schema.items = resolveMaybeRef(schema.items, spec) || schema.items;
    return schema;
  }

  function isFileLikeSchema(schema) {
    if (!schema) return false;
    if (schema.type === 'file') return true;
    if (schema.format === 'binary') return true;
    if (schema.type === 'string' && schema.format === 'binary') return true;
    if (schema.type === 'array') return isFileLikeSchema(schema.items || {});
    return false;
  }

  function isMultiFileSchema(schema) {
    return schema && schema.type === 'array' && isFileLikeSchema(schema.items || {});
  }

  function pushOpenApi3BodyParams(params, body, spec) {
    const content = body.content || {};
    const isForm = !!content['multipart/form-data'];
    const ct = content['multipart/form-data'] || content['application/json'] || Object.values(content)[0];
    if (!ct) return;

    const schema = typeof window.resolveSchema === 'function'
      ? window.resolveSchema(ct.schema || {}, spec)
      : (ct.schema || {});
    const props = schema && schema.properties ? schema.properties : {};
    const required = schema && schema.required ? schema.required : [];

    if (Object.keys(props).length) {
      for (const [key, rawProp] of Object.entries(props)) {
        const prop = typeof window.resolveSchema === 'function' ? window.resolveSchema(rawProp, spec) : rawProp;
        if (isFileLikeSchema(prop)) {
          params.push({
            k: key,
            loc: 'body',
            label: key,
            req: required.includes(key),
            desc: prop && prop.description ? prop.description : '',
            type: isMultiFileSchema(prop) ? 'file-multi' : 'file',
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
        if (isFileLikeSchema(schema)) {
          params.push({
            k: param.name,
            loc: 'body',
            label: param.name,
            req: required,
            desc,
            type: isMultiFileSchema(schema) ? 'file-multi' : 'file',
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
