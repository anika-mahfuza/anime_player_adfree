import { fetchWithTimeout, readJsonBody, sendJson } from './http.js';

const cache = new Map();
const maxCacheSize = 300;
const TTL_SEARCH = 3 * 60 * 1000;   // 3 min
const TTL_HOME   = 15 * 60 * 1000;  // 15 min — home sections change slowly
const TTL_DEFAULT = 5 * 60 * 1000;  // 5 min
const defaultAniListTimeoutMs = 60000;

function getAniListTimeoutMs() {
  const value = Number(process.env.ANILIST_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : defaultAniListTimeoutMs;
}

const anilistTimeoutMs = getAniListTimeoutMs();

function getCacheKey(query, variables) {
  return JSON.stringify({ query, variables });
}

// Home queries contain multiple named Page aliases (trending, airing, popular…)
// Search queries have a variable `$s`. Everything else gets the default TTL.
function getCacheTtl(query) {
  if (query.includes('mutation')) return 0;
  if (/\$s\b/.test(query)) return TTL_SEARCH;
  // Multi-alias home queries: detect by counting 'Page(' occurrences
  if ((query.match(/\bPage\s*\(/g) || []).length >= 2) return TTL_HOME;
  if (query.includes('Page')) return TTL_DEFAULT;
  return TTL_DEFAULT;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now >= value.expiry) cache.delete(key);
  }
}, 60000).unref?.();

export async function handleAniList({ req, res }) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'POST, OPTIONS' });
  }

  try {
    const { query = '', variables = {} } = await readJsonBody(req);
    if (!query) {
      return sendJson(res, 400, { errors: [{ message: 'Missing query' }] });
    }

    const cacheKey = getCacheKey(query, variables);
    const cached = cache.get(cacheKey);
    if (cached && Date.now() < cached.expiry) {
      return sendJson(res, 200, cached.data, { 'X-Cache': 'HIT' });
    }

    const response = await fetchWithTimeout(
      'https://graphql.anilist.co',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
        body: JSON.stringify({ query, variables }),
      },
      anilistTimeoutMs,
    );

    const data = await response.json();

    if (response.ok && !data.errors) {
      const ttl = getCacheTtl(query);
      if (ttl > 0) {
        if (cache.size >= maxCacheSize) {
          const firstKey = cache.keys().next().value;
          cache.delete(firstKey);
        }
        cache.set(cacheKey, { data, expiry: Date.now() + ttl });
      }
    }

    return sendJson(res, response.ok ? 200 : response.status, data, { 'X-Cache': 'MISS' });
  } catch (error) {
    if (error?.name === 'AbortError') {
      return sendJson(res, 504, { errors: [{ message: `AniList request timed out after ${anilistTimeoutMs}ms` }] });
    }

    console.error('[anilist] Proxy error:', error);
    return sendJson(res, 500, { errors: [{ message: error.message }] });
  }
}
