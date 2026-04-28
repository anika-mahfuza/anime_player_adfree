import { fetchWithTimeout, sendJson } from './http.js';

const cache = new Map();
const cacheTtlMs = 5 * 60 * 1000;
const maxCacheSize = 300;
const defaultTimeoutMs = 15000;

function pruneExpiredCache() {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

function readCache(key) {
  pruneExpiredCache();
  const entry = cache.get(key);
  return entry?.value ?? null;
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

function parsePositiveId(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function fetchAniZipPayload(idType, idValue) {
  const upstreamUrl = new URL('https://api.ani.zip/mappings');
  upstreamUrl.searchParams.set(idType, String(idValue));

  const response = await fetchWithTimeout(
    upstreamUrl,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'AniStream/1.0 (+https://api.ani.zip/)',
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
      error: raw || `HTTP ${response.status}`,
    };
  }

  return {
    status: response.status,
    payload,
  };
}

export async function handleAniZip({ req, res, url }) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, OPTIONS' });
  }

  const lookupCandidates = [
    ['mal_id', parsePositiveId(url.searchParams.get('mal_id'))],
    ['anilist_id', parsePositiveId(url.searchParams.get('anilist_id'))],
  ].filter(([, value]) => value);

  if (lookupCandidates.length === 0) {
    return sendJson(res, 400, { error: 'Missing or invalid AniZip lookup id' });
  }

  try {
    for (const [idType, idValue] of lookupCandidates) {
      const cacheKey = `anizip:${idType}:${idValue}`;
      const cached = readCache(cacheKey);
      if (cached) {
        return sendJson(res, 200, cached, { 'X-Cache': 'HIT' });
      }

      const result = await fetchAniZipPayload(idType, idValue);
      if (result.status >= 200 && result.status < 300) {
        writeCache(cacheKey, result.payload);
        return sendJson(res, result.status, result.payload, { 'X-Cache': 'MISS' });
      }

      if (result.status !== 404) {
        return sendJson(res, result.status, result.payload, { 'X-Cache': 'MISS' });
      }
    }

    return sendJson(res, 404, { error: 'AniZip mapping not found' }, { 'X-Cache': 'MISS' });
  } catch (error) {
    console.error('[anizip] Proxy error:', error);
    return sendJson(res, 500, { error: error.message || 'AniZip proxy failed' });
  }
}
