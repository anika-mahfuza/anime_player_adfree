import { apiUrl } from '@/lib/apiBase';
import { pacedJsonFetch } from '@/lib/requestScheduler';

export async function jikanRequest(path, query = {}, { cacheTtlMs = 0, key } = {}) {
  const params = new URLSearchParams();
  params.set('path', path);

  for (const [queryKey, value] of Object.entries(query || {})) {
    if (value == null || value === '') continue;
    params.set(queryKey, String(value));
  }

  const requestKey = key || `jikan:${path}?${params.toString()}`;
  return pacedJsonFetch(apiUrl(`/api/jikan?${params.toString()}`), undefined, {
    key: requestKey,
    cacheTtlMs,
  });
}

function normalizeTitle(item) {
  return {
    romaji: item?.title || item?.title_english || item?.title_japanese || 'Unknown',
    english: item?.title_english || item?.title || item?.title_japanese || 'Unknown',
    native: item?.title_japanese || item?.title || item?.title_english || 'Unknown',
  };
}

function normalizeStatus(status, airing = false) {
  if (airing || status === 'Currently Airing') return 'RELEASING';

  return {
    'Finished Airing': 'FINISHED',
    'Not yet aired': 'NOT_YET_RELEASED',
    'Not Yet Aired': 'NOT_YET_RELEASED',
    Cancelled: 'CANCELLED',
    Hiatus: 'HIATUS',
  }[status] ?? String(status || '').toUpperCase().replace(/\s+/g, '_');
}

function normalizeFormat(type) {
  return type ? String(type).toUpperCase().replace(/\s+/g, '_') : null;
}

function normalizeGenres(item) {
  return [
    ...(Array.isArray(item?.genres) ? item.genres : []),
    ...(Array.isArray(item?.themes) ? item.themes : []),
    ...(Array.isArray(item?.demographics) ? item.demographics : []),
  ]
    .map((entry) => entry?.name)
    .filter(Boolean);
}

function parseDurationMinutes(value) {
  if (!value) return null;
  const match = String(value).match(/(\d+)\s*min/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function normalizeRelationType(relation) {
  const normalized = String(relation || '').toLowerCase();
  if (normalized.includes('prequel')) return 'PREQUEL';
  if (normalized.includes('sequel')) return 'SEQUEL';
  if (normalized.includes('spin-off') || normalized.includes('spinoff')) return 'SPIN_OFF';
  if (normalized.includes('side story')) return 'SIDE_STORY';
  if (normalized.includes('summary') || normalized.includes('compilation')) return 'COMPILATION';
  if (normalized.includes('alternative')) return 'ALTERNATIVE';
  return 'OTHER';
}

export function normalizeJikanAnime(item) {
  if (!item?.mal_id) return null;

  const genres = normalizeGenres(item);

  return {
    id: item.mal_id,
    idMal: item.mal_id,
    provider: 'jikan',
    title: normalizeTitle(item),
    description: item.synopsis || item.background || '',
    coverImage: {
      extraLarge: item.images?.jpg?.large_image_url || item.images?.jpg?.image_url || null,
      large: item.images?.jpg?.large_image_url || item.images?.jpg?.image_url || null,
      medium: item.images?.jpg?.image_url || item.images?.jpg?.large_image_url || null,
      color: null,
    },
    bannerImage: item.trailer?.images?.maximum_image_url || item.trailer?.images?.large_image_url || null,
    episodes: item.episodes || null,
    meanScore: item.score ? Math.round(item.score * 10) : null,
    popularity: item.popularity ?? null,
    status: normalizeStatus(item.status, item.airing),
    format: normalizeFormat(item.type),
    genres,
    tags: genres.map((name) => ({ name, rank: 50 })),
    season: item.season ? String(item.season).toUpperCase() : null,
    seasonYear: item.year || null,
    duration: parseDurationMinutes(item.duration),
    nextAiringEpisode: null,
    studios: {
      nodes: Array.isArray(item.studios) ? item.studios.map((studio) => ({ name: studio?.name })).filter((studio) => studio.name) : [],
    },
  };
}

function normalizeJikanRelations(relations = []) {
  return relations.flatMap((group) => (
    Array.isArray(group?.entry)
      ? group.entry
        .filter((entry) => String(entry?.type || '').toLowerCase() === 'anime')
        .map((entry) => ({
          relationType: normalizeRelationType(group?.relation),
          node: {
            id: entry.mal_id,
            idMal: entry.mal_id,
            type: 'ANIME',
            format: null,
            title: {
              romaji: entry.name || 'Unknown',
              english: entry.name || 'Unknown',
              native: entry.name || 'Unknown',
            },
            coverImage: { large: null, extraLarge: null },
            seasonYear: null,
            status: null,
            episodes: null,
          },
        }))
      : []
  ));
}

function normalizeJikanRecommendations(recommendations = []) {
  return recommendations
    .map((item) => {
      const entry = item?.entry;
      if (!entry?.mal_id) return null;
      return {
        mediaRecommendation: {
          id: entry.mal_id,
          idMal: entry.mal_id,
          provider: 'jikan',
          title: {
            romaji: entry.title || 'Unknown',
            english: entry.title || 'Unknown',
            native: entry.title || 'Unknown',
          },
          coverImage: {
            extraLarge: entry.images?.jpg?.large_image_url || entry.images?.jpg?.image_url || null,
            large: entry.images?.jpg?.large_image_url || entry.images?.jpg?.image_url || null,
          },
          bannerImage: null,
          episodes: null,
          meanScore: null,
          status: null,
          format: null,
          genres: [],
          season: null,
          seasonYear: null,
        },
      };
    })
    .filter(Boolean);
}

export async function searchJikanAnime(term, { limit = 24, page = 1, key, cacheTtlMs = 60 * 1000 } = {}) {
  const payload = await jikanRequest('/anime', {
    q: term,
    page,
    limit,
    order_by: 'popularity',
    sort: 'desc',
    sfw: 'true',
  }, {
    key: key || `jikan-search:${term.trim().toLowerCase()}:${page}:${limit}`,
    cacheTtlMs,
  });

  const media = Array.isArray(payload?.data)
    ? payload.data.map(normalizeJikanAnime).filter(Boolean)
    : [];

  return {
    media,
    total: payload?.pagination?.items?.total ?? media.length,
  };
}

export async function fetchJikanAnimeDetails(malId, { keyPrefix = `jikan-anime:${malId}`, cacheTtlMs = 5 * 60 * 1000 } = {}) {
  const [animePayload, relationsPayload, recommendationsPayload] = await Promise.allSettled([
    jikanRequest(`/anime/${malId}/full`, {}, {
      key: `${keyPrefix}:full`,
      cacheTtlMs,
    }),
    jikanRequest(`/anime/${malId}/relations`, {}, {
      key: `${keyPrefix}:relations`,
      cacheTtlMs,
    }),
    jikanRequest(`/anime/${malId}/recommendations`, {}, {
      key: `${keyPrefix}:recommendations`,
      cacheTtlMs,
    }),
  ]);

  if (animePayload.status !== 'fulfilled' || !animePayload.value?.data) {
    throw new Error('Anime not found');
  }

  const anime = normalizeJikanAnime(animePayload.value.data);
  return {
    ...anime,
    relations: {
      edges: normalizeJikanRelations(relationsPayload.status === 'fulfilled' ? relationsPayload.value?.data : animePayload.value.data?.relations),
    },
    recommendations: {
      nodes: normalizeJikanRecommendations(recommendationsPayload.status === 'fulfilled' ? recommendationsPayload.value?.data : []),
    },
  };
}

export async function fetchJikanAnimeMetadataBatch(ids, { cacheTtlMs = 10 * 60 * 1000 } = {}) {
  const normalizedIds = [...new Set(ids.map((id) => Number.parseInt(id, 10)).filter(Boolean))];
  if (normalizedIds.length === 0) return [];

  const results = await Promise.allSettled(
    normalizedIds.map((id) => (
      jikanRequest(`/anime/${id}`, {}, {
        key: `jikan:metadata:${id}`,
        cacheTtlMs,
      })
    )),
  );

  return results
    .map((result) => (result.status === 'fulfilled' ? normalizeJikanAnime(result.value?.data) : null))
    .filter(Boolean);
}
