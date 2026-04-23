const API_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export { API_CORS_HEADERS };

export function applyCors(res, extraHeaders = {}) {
  const headers = { ...API_CORS_HEADERS, ...extraHeaders };
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
}

export function getRequestOrigin(req) {
  const protoHeader = req.headers['x-forwarded-proto'];
  const hostHeader = req.headers['x-forwarded-host'] || req.headers.host;
  const protocol = Array.isArray(protoHeader)
    ? protoHeader[0]
    : String(protoHeader || 'http').split(',')[0].trim() || 'http';
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;

  return `${protocol}://${host || `localhost:${process.env.PORT || 3001}`}`;
}

export async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

export function sendJson(res, statusCode, payload, extraHeaders = {}) {
  applyCors(res, extraHeaders);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export function sendText(res, statusCode, body, extraHeaders = {}) {
  applyCors(res, extraHeaders);
  res.statusCode = statusCode;
  if (!res.hasHeader('Content-Type')) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  }
  for (const [key, value] of Object.entries(extraHeaders)) {
    res.setHeader(key, value);
  }
  res.end(body);
}

export function sendBinary(res, statusCode, body, extraHeaders = {}) {
  applyCors(res, extraHeaders);
  res.statusCode = statusCode;
  for (const [key, value] of Object.entries(extraHeaders)) {
    res.setHeader(key, value);
  }
  res.end(Buffer.isBuffer(body) ? body : Buffer.from(body));
}

export function sendNoContent(res, extraHeaders = {}) {
  applyCors(res, extraHeaders);
  res.statusCode = 204;
  res.end();
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function parsePositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function uniquePositiveIntegers(values) {
  const seen = new Set();
  const output = [];

  for (const value of values) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || seen.has(parsed)) continue;
    seen.add(parsed);
    output.push(parsed);
  }

  return output;
}

export function safeOrigin(value, fallback = null) {
  try {
    return `${new URL(value).origin}/`;
  } catch {
    return fallback;
  }
}
