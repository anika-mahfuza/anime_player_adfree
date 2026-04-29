import { fetchWithTimeout } from './http.js';

// Levenshtein distance helper for title similarity
function levenshtein(a, b) {
  const an = a.length, bn = b.length;
  const matrix = Array.from({ length: an + 1 }, (_, i) => [i]);
  for (let j = 0; j <= bn; j++) matrix[0][j] = j;
  for (let i = 1; i <= an; i++) {
    for (let j = 1; j <= bn; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[an][bn];
}

function similarity(a, b) {
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  // Exact match is best
  if (lowerA === lowerB) return 0;
  // Shorter string distance
  return levenshtein(lowerA, lowerB);
}

const cache = new Map();
const cacheTtlMs = 30 * 60 * 1000;
const defaultTimeoutMs = 15000;

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

async function searchKuudere(title) {
  const cacheKey = `search:${title}`;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const searchUrl = `https://kuudere.ru/api/search?q=${encodeURIComponent(title)}`;
  const response = await fetchWithTimeout(searchUrl, {}, defaultTimeoutMs);

  if (!response.ok) {
    throw new Error(`Kuudere search failed: HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!data.success || !data.results || data.results.length === 0) {
    return null;
  }

  // Instead of .results[0], pick the most similar title
  let best = data.results[0];
  let bestScore = similarity(title, best.title);
  for (let i = 1; i < data.results.length; i++) {
    const score = similarity(title, data.results[i].title);
    if (score < bestScore) {
      bestScore = score;
      best = data.results[i];
    }
  }

  console.log(`[skipprovider] Kuudere search for "${title}" -> best match: "${best.title}" (score=${bestScore})`);

  writeCache(cacheKey, best);
  return best;
}

async function fetchKuudereWatchData(kuudereId, episode, lang) {
  const watchUrl = `https://kuudere.ru/api/watch/${kuudereId}/${episode}?lang=${lang}`;
  const response = await fetchWithTimeout(watchUrl, {}, defaultTimeoutMs);

  if (!response.ok) {
    throw new Error(`Kuudere watch failed: HTTP ${response.status}`);
  }

  return await response.json();
}

async function fetchEmbedSkipTimes(embedUrl) {
  // Extract embed ID from URL (e.g., https://zencloudz.cc/e/s6tskwvwlym3?v=2&a=0)
  const embedId = embedUrl.match(/\/e\/([a-zA-Z0-9]+)/)?.[1];
  if (!embedId) {
    throw new Error('Could not extract embed ID from URL');
  }

  const embedOrigin = new URL(embedUrl).origin;
  const propsUrl = `${embedOrigin}/e/${embedId}/__data.json`;

  const response = await fetchWithTimeout(propsUrl, {}, defaultTimeoutMs);
  if (!response.ok) {
    throw new Error(`Embed data fetch failed: HTTP ${response.status}`);
  }

  const props = await response.json();

  // Navigate the complex JSON structure to extract intro/outro
  const dataArr = props.nodes?.[3]?.data;
  if (!dataArr) {
    // No skip time data in this embed (valid case - not all episodes have skip times)
    return { intro: null, outro: null };
  }

  const refs = dataArr[0];
  const resolve = (key) => {
    const idx = refs[key];
    return (typeof idx === 'number') ? dataArr[idx] : undefined;
  };

  // Raw chapter objects (indices)
  const introRaw = resolve('intro_chapter');
  const outroRaw = resolve('outro_chapter');

  // Resolve indices to actual values
  function resolveChapter(raw) {
    if (!raw) return null;
    const startIdx = raw.start;
    const endIdx = raw.end;
    const start = typeof startIdx === 'number' ? dataArr[startIdx] : undefined;
    const end = typeof endIdx === 'number' ? dataArr[endIdx] : undefined;
    if (typeof start !== 'number' || typeof end !== 'number') return null;
    return { start, end };
  }

  const intro = resolveChapter(introRaw);
  const outro = resolveChapter(outroRaw);

  return { intro, outro };
}

export async function fetchKuudereSkipTimes(title, episode, lang = 'sub') {
  if (!title || !episode) {
    throw new Error('Missing title or episode');
  }

  const searchResult = await searchKuudere(title);
  if (!searchResult) {
    throw new Error(`Anime not found on Kuudere: ${title}`);
  }

  // Get watch data to find embed links
  const watchData = await fetchKuudereWatchData(searchResult.id, episode, lang);

  // Find embed link for the requested language
  const embedLink = watchData.episode_links?.find(l => l.dataType === lang);
  if (!embedLink?.dataLink) {
    throw new Error(`No embed link found for language: ${lang}`);
  }

  console.log(`[skipprovider] Kuudere embed URL for "${title}" ep${episode}: ${embedLink.dataLink}`);

  // Fetch skip times from embed __data.json
  const { intro, outro } = await fetchEmbedSkipTimes(embedLink.dataLink);

  return {
    intro: intro ? { startTime: intro.start, endTime: intro.end } : null,
    outro: outro ? { startTime: outro.start, endTime: outro.end } : null,
    _meta: {
      kuudereId: searchResult.id,
      kuudereTitle: searchResult.title,
      embedUrl: embedLink.dataLink,
    },
  };
}
