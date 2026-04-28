import { fetchWithTimeout, sendJson } from './http.js';

const cache = new Map();
const cacheTtlMs = 30 * 60 * 1000;
const defaultTimeoutMs = 15000;
const megaplayOrigin = 'https://megaplay.buzz';
const userAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function readCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache(key, value) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + cacheTtlMs,
  });
}

async function fetchText(url, headers = {}) {
  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        'User-Agent': userAgent,
        Origin: megaplayOrigin,
        Referer: `${megaplayOrigin}/api`,
        ...headers,
      },
    },
    defaultTimeoutMs,
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

function normalizeSegment(startTime, endTime) {
  const normalizedStart = Number(startTime);
  const normalizedEnd = Number(endTime);
  if (!Number.isFinite(normalizedStart) || !Number.isFinite(normalizedEnd)) return null;
  if (normalizedStart < 0 || normalizedEnd <= normalizedStart) return null;
  if (normalizedStart === 0 && normalizedEnd === 0) return null;

  return {
    startTime: normalizedStart,
    endTime: normalizedEnd,
  };
}

async function fetchMegaplaySkipTimes(malId, episode, language) {
  const streamPageUrl = `${megaplayOrigin}/stream/mal/${malId}/${episode}/${language}`;
  const page = await fetchText(streamPageUrl);
  const dataIdMatch = page.match(/data-id="(\d+)"/);
  if (!dataIdMatch) {
    throw new Error('Megaplay data-id not found');
  }

  const sourcesUrl = `${megaplayOrigin}/stream/getSources?id=${dataIdMatch[1]}`;
  const sourcesRaw = await fetchText(sourcesUrl, {
    Accept: 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest',
  });
  const sources = JSON.parse(sourcesRaw);

  return {
    intro: normalizeSegment(sources?.intro?.start, sources?.intro?.end),
    outro: normalizeSegment(sources?.outro?.start, sources?.outro?.end),
  };
}

export async function handleSkipTimes({ req, res, url }) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, OPTIONS' });
  }

  const malId = parsePositiveInteger(url.searchParams.get('malId') || url.searchParams.get('mal_id'));
  const episode = parsePositiveInteger(url.searchParams.get('episode'));
  const language = String(url.searchParams.get('lang') || 'sub').toLowerCase() === 'dub' ? 'dub' : 'sub';

  if (!malId || !episode) {
    return sendJson(res, 400, { error: 'Missing malId or episode' });
  }

  const cacheKey = `skip:${malId}:${episode}:${language}`;
  const cached = readCache(cacheKey);
  if (cached) {
    return sendJson(res, 200, cached, { 'X-Cache': 'HIT' });
  }

  try {
    const skipTimes = await fetchMegaplaySkipTimes(malId, episode, language);
    const payload = {
      skipTimes: skipTimes.intro || skipTimes.outro ? skipTimes : null,
      source: 'megaplay',
      language,
      resolvedMalId: malId,
      episode,
    };

    writeCache(cacheKey, payload);
    return sendJson(res, 200, payload, { 'X-Cache': 'MISS' });
  } catch (error) {
    console.warn('[skip-times] Failed to fetch skip timestamps:', error.message);
    return sendJson(res, 200, {
      skipTimes: null,
      source: 'none',
      language,
      resolvedMalId: malId,
      episode,
      error: error.message || 'Skip timestamp lookup failed',
    }, { 'X-Cache': 'MISS' });
  }
}
