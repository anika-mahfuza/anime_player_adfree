import { fetchWithTimeout, sendJson } from './http.js';
import { fetchKuudereSkipTimes } from './skipTimesProvider.js';

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
  const start = Number(startTime);
  const end = Number(endTime);

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end <= start) return null;
  if (start === 0 && end === 0) return null;

  return {
    startTime: start,
    endTime: end,
    duration: end - start,
  };
}

async function fetchMegaplaySkipTimes(malId, episode, language) {
  // STEP 1: Fetch the stream page from MegaPlay
  const streamPageUrl = `${megaplayOrigin}/stream/mal/${malId}/${episode}/${language}`;
  const page1 = await fetchText(streamPageUrl, {
    Origin: megaplayOrigin,
    Referer: `${megaplayOrigin}/api`,
  });

  // STEP 2: Extract the iframe embed URL (e.g. vidwish.live)
  const iframeMatch =
    page1.match(/<iframe[^>]+src=["']([^"']+)["']/i) ||
    page1.match(/src=["'](https?:\/\/[^"']+)["']/i);

  if (!iframeMatch) {
    throw new Error('Iframe/Embed src not found in stream page');
  }

  let embedUrl = iframeMatch[1];

  // Handle relative protocol or relative paths
  if (embedUrl.startsWith('//')) {
    embedUrl = 'https:' + embedUrl;
  } else if (embedUrl.startsWith('/')) {
    embedUrl = megaplayOrigin + embedUrl;
  }

  const embedOrigin = new URL(embedUrl).origin;

  // STEP 3: Fetch the embed page using the extracted URL
  const page2 = await fetchText(embedUrl, {
    Referer: streamPageUrl,
  });

  // STEP 4: Extract data-id from the embed page HTML
  const dataIdMatch = page2.match(/data-id="(\d+)"/);
  if (!dataIdMatch) {
    throw new Error('data-id not found in embed page');
  }
  const dataId = dataIdMatch[1];

  // STEP 5: Call the getSources endpoint on the embed domain
  const sourcesUrl = `${embedOrigin}/stream/getSources?id=${dataId}&id=${dataId}`;
  const raw = await fetchText(sourcesUrl, {
    Accept: 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest',
    Referer: embedUrl,
  });

  const json = JSON.parse(raw);

  return {
    intro: normalizeSegment(json?.intro?.start, json?.intro?.end),
    outro: normalizeSegment(json?.outro?.start, json?.outro?.end),
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
    let skipTimes;
    let source = 'none';
    let megaplayError = null;

    // Try megaplay first
    try {
      skipTimes = await fetchMegaplaySkipTimes(malId, episode, language);
      if (skipTimes.intro || skipTimes.outro) {
        source = 'megaplay';
        console.log(`[skip-times] Megaplay SUCCESS for MAL:${malId} ep${episode} - intro:${skipTimes.intro?.startTime || '-'}s, outro:${skipTimes.outro?.startTime || '-'}s`);
      } else {
        console.log(`[skip-times] Megaplay returned EMPTY for MAL:${malId} ep${episode} (no intro/outro data)`);
      }
    } catch (megaplayErr) {
      megaplayError = megaplayErr;
      console.warn(`[skip-times] Megaplay FAILED for MAL:${malId} ep${episode}:`, megaplayErr.message);
    }

    // If megaplay failed or returned empty, try Kuudere as fallback
    if (source === 'none') {
      const title = url.searchParams.get('title');
      if (title) {
        console.log(`[skip-times] >>> FALLBACK: Trying Kuudere for "${title}" ep${episode}...`);
        try {
          const kuudereData = await fetchKuudereSkipTimes(title, episode, language);
          if (kuudereData.intro || kuudereData.outro) {
            skipTimes = kuudereData;
            source = 'kuudere';
            console.log(`[skip-times] >>> FALLBACK SUCCESS: Kuudere worked for "${title}" ep${episode} - intro:${kuudereData.intro?.startTime || '-'}s, outro:${kuudereData.outro?.startTime || '-'}s`);
          } else {
            console.log(`[skip-times] >>> FALLBACK EMPTY: Kuudere also has no data for "${title}" ep${episode}`);
          }
        } catch (kuudereError) {
          console.warn(`[skip-times] >>> FALLBACK FAILED: Kuudere error for "${title}" ep${episode}:`, kuudereError.message);
        }
      } else {
        console.log(`[skip-times] >>> NO FALLBACK: No title provided for Kuudere fallback (MAL:${malId} ep${episode})`);
      }
    }

    const payload = {
      skipTimes: skipTimes.intro || skipTimes.outro ? skipTimes : null,
      source: skipTimes.intro || skipTimes.outro ? source : 'none',
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
