import { fetchWithTimeout, sendJson } from './http.js';

const cache = new Map();
const cacheTtlMs = 10 * 60 * 1000;
const maxCacheSize = 300;
const defaultTimeoutMs = 20000;
const jikanMinGapMs = 400;
const retryableStatuses = new Set([429, 500, 502, 503, 504]);

let lastStartedAt = 0;
let queueTail = Promise.resolve();

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pruneExpiredCache() {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

function readCache(key) {
  pruneExpiredCache();
  const entry = cache.get(key);
  if (!entry) return null;
  return entry.value;
}

function writeCache(key, value) {
  pruneExpiredCache();
  if (cache.size >= maxCacheSize) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, {
    value,
    expiresAt: Date.now() + cacheTtlMs,
  });
}

function parseRetryAfterMs(value) {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const retryAt = Date.parse(value);
  if (Number.isNaN(retryAt)) return null;

  return Math.max(0, retryAt - Date.now());
}

function normalizeJikanPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.includes('://') || raw.includes('..')) return null;

  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const normalized = withLeadingSlash.replace(/^\/v4(?=\/|$)/, '') || '/';
  return normalized.startsWith('/') ? normalized : null;
}

function buildUpstreamUrl(url) {
  const path = normalizeJikanPath(url.searchParams.get('path'));
  if (!path) return null;

  const upstreamUrl = new URL(`https://api.jikan.moe/v4${path}`);
  for (const [key, value] of url.searchParams.entries()) {
    if (key === 'path') continue;
    upstreamUrl.searchParams.append(key, value);
  }
  return upstreamUrl;
}

async function scheduleJikanRequest(task) {
  const scheduled = queueTail.then(async () => {
    const delay = Math.max(0, jikanMinGapMs - (Date.now() - lastStartedAt));
    if (delay > 0) await wait(delay);
    lastStartedAt = Date.now();
    return task();
  });

  queueTail = scheduled.catch(() => {});
  return scheduled;
}

async function fetchJikanPayload(upstreamUrl, attempt = 0) {
  const response = await fetchWithTimeout(
    upstreamUrl,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'AniStream/1.0 (+https://api.jikan.moe/)',
      },
    },
    defaultTimeoutMs,
  );

  const raw = await response.text();
  let payload;

  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {
      status: response.status,
      message: raw || `HTTP ${response.status}`,
    };
  }

  if (response.ok || !retryableStatuses.has(response.status) || attempt >= 2) {
    return {
      status: response.status,
      payload,
      retryAfter: response.headers.get('retry-after'),
    };
  }

  const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
  const backoffMs = retryAfterMs ?? (1200 * (2 ** attempt));
  await wait(backoffMs);
  return fetchJikanPayload(upstreamUrl, attempt + 1);
}

export async function handleJikan({ req, res, url }) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, OPTIONS' });
  }

  const upstreamUrl = buildUpstreamUrl(url);
  if (!upstreamUrl) {
    return sendJson(res, 400, { error: 'Missing or invalid Jikan path' });
  }

  const cacheKey = upstreamUrl.toString();
  const cached = readCache(cacheKey);
  if (cached) {
    return sendJson(res, 200, cached, { 'X-Cache': 'HIT' });
  }

  try {
    const result = await scheduleJikanRequest(() => fetchJikanPayload(upstreamUrl));
    const extraHeaders = { 'X-Cache': 'MISS' };
    if (result.retryAfter) extraHeaders['Retry-After'] = result.retryAfter;

    if (result.status >= 200 && result.status < 300) {
      writeCache(cacheKey, result.payload);
    }

    return sendJson(res, result.status, result.payload, extraHeaders);
  } catch (error) {
    console.error('[jikan] Proxy error:', error);
    return sendJson(res, 500, { error: error.message || 'Jikan proxy failed' });
  }
}
