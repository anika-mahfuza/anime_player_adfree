import { fetchWithTimeout, sendJson } from './http.js';

// ── Cache ─────────────────────────────────────────────────────────────────────
const homeCache = new Map();
const HOME_TTL = 15 * 60 * 1000; // 15 min

function getCached() {
  const entry = homeCache.get('home');
  if (entry && Date.now() < entry.expiry) return entry.data;
  homeCache.delete('home');
  return null;
}

function setCached(data) {
  homeCache.set('home', { data, expiry: Date.now() + HOME_TTL });
}

// ── AniList fetcher ───────────────────────────────────────────────────────────
async function anilist(query, variables = {}) {
  const res = await fetchWithTimeout(
    'https://graphql.anilist.co',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
      body: JSON.stringify({ query, variables }),
    },
    20000,
  );
  if (!res.ok) throw new Error(`AniList HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

// ── Queries ───────────────────────────────────────────────────────────────────
// AiringSchedule — what pro sites (HiAnime, AniWave) use for "Airing Now".
// Gives real episode numbers from the broadcast schedule, not just metadata.
const SCHEDULE_QUERY = `
query ($from: Int, $to: Int) {
  Page(perPage: 50) {
    airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME_DESC) {
      episode
      airingAt
      media {
        id idMal bannerImage season seasonYear
        title { romaji english }
        coverImage { extraLarge large }
        episodes meanScore genres status format
        nextAiringEpisode { episode airingAt }
      }
    }
  }
}`;

const FIELDS = `
  id idMal bannerImage season seasonYear
  title { romaji english }
  coverImage { extraLarge large }
  episodes meanScore genres status format
  nextAiringEpisode { episode airingAt }
`;

// One batched query for all non-airing sections — runs in parallel with schedule
const BATCH_QUERY = `
query {
  trending: Page(perPage: 20) { media(type: ANIME, isAdult: false, sort: TRENDING_DESC) { ${FIELDS} } }
  popular:  Page(perPage: 20) { media(type: ANIME, isAdult: false, sort: POPULARITY_DESC) { ${FIELDS} } }
  topRated: Page(perPage: 20) { media(type: ANIME, isAdult: false, sort: SCORE_DESC, episodes_greater: 1) { ${FIELDS} } }
  movies:   Page(perPage: 20) { media(type: ANIME, isAdult: false, format: MOVIE, sort: POPULARITY_DESC) { ${FIELDS} } }
  action:   Page(perPage: 20) { media(type: ANIME, isAdult: false, genre_in: ["Action"], sort: POPULARITY_DESC) { ${FIELDS} } }
  romance:  Page(perPage: 20) { media(type: ANIME, isAdult: false, genre_in: ["Romance"], sort: POPULARITY_DESC) { ${FIELDS} } }
  fantasy:  Page(perPage: 20) { media(type: ANIME, isAdult: false, genre_in: ["Fantasy"], sort: POPULARITY_DESC) { ${FIELDS} } }
  comedy:   Page(perPage: 20) { media(type: ANIME, isAdult: false, genre_in: ["Comedy"], sort: POPULARITY_DESC) { ${FIELDS} } }
  upcoming: Page(perPage: 20) { media(type: ANIME, isAdult: false, status: NOT_YET_RELEASED, sort: POPULARITY_DESC) { ${FIELDS} } }
}`;

// ── Build airing list from schedule data ──────────────────────────────────────
function buildAiringFromSchedule(scheduleData) {
  const seen = new Set();
  const result = [];

  for (const entry of scheduleData?.Page?.airingSchedules ?? []) {
    const media = entry?.media;
    if (!media?.id || seen.has(media.id)) continue;
    seen.add(media.id);
    // Inject real broadcast episode number from the schedule
    result.push({
      ...media,
      nextAiringEpisode: { episode: entry.episode, airingAt: entry.airingAt },
    });
  }

  return result;
}

// ── Handler ───────────────────────────────────────────────────────────────────
export async function handleHome({ req, res }) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const cached = getCached();
  if (cached) {
    return sendJson(res, 200, cached, { 'X-Cache': 'HIT' });
  }

  try {
    const now  = Math.floor(Date.now() / 1000);
    const from = now - 4 * 24 * 60 * 60; // 4 days back
    const to   = now + 3 * 24 * 60 * 60; // 3 days ahead

    // Fire both requests simultaneously on the server
    const [scheduleData, batchData] = await Promise.all([
      anilist(SCHEDULE_QUERY, { from, to }),
      anilist(BATCH_QUERY),
    ]);

    const payload = {
      airing:   { media: buildAiringFromSchedule(scheduleData) },
      trending: batchData.trending,
      popular:  batchData.popular,
      topRated: batchData.topRated,
      movies:   batchData.movies,
      action:   batchData.action,
      romance:  batchData.romance,
      fantasy:  batchData.fantasy,
      comedy:   batchData.comedy,
      upcoming: batchData.upcoming,
    };

    setCached(payload);
    return sendJson(res, 200, payload, { 'X-Cache': 'MISS' });
  } catch (err) {
    console.error('[home] Error:', err.message);
    return sendJson(res, 502, { error: err.message });
  }
}
