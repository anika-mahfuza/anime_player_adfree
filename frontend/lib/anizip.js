import { apiUrl } from '@/lib/apiBase';
import { pacedJsonFetch } from '@/lib/requestScheduler';

function pickEpisodeTitle(title) {
  if (!title || typeof title !== 'object') return null;

  return title.en
    || title['x-jat']
    || title.ja
    || Object.values(title).find(Boolean)
    || null;
}

function normalizeAniZipEpisode(entryNumber, entry) {
  const number = Number.parseInt(String(entry?.episode ?? entryNumber), 10);
  if (!Number.isFinite(number) || number <= 0) return null;

  return {
    mal_id: number,
    number,
    title: pickEpisodeTitle(entry?.title),
    description: entry?.overview || entry?.summary || null,
    image: entry?.image || null,
    airDate: entry?.airDateUtc || entry?.airDate || entry?.airdate || null,
    runtime: Number(entry?.runtime || entry?.length) || null,
    filler: false,
  };
}

export function normalizeAniZipEpisodes(payload) {
  const rawEpisodes = payload?.episodes;
  if (!rawEpisodes || typeof rawEpisodes !== 'object') return [];

  return Object.entries(rawEpisodes)
    .map(([entryNumber, entry]) => normalizeAniZipEpisode(entryNumber, entry))
    .filter(Boolean)
    .sort((left, right) => left.mal_id - right.mal_id);
}

function buildAniZipQuery({ malId, anilistId }) {
  const normalizedMalId = Number.parseInt(String(malId || ''), 10);
  const normalizedAniListId = Number.parseInt(String(anilistId || ''), 10);
  const params = new URLSearchParams();

  if (Number.isFinite(normalizedMalId) && normalizedMalId > 0) {
    params.set('mal_id', String(normalizedMalId));
  }
  if (Number.isFinite(normalizedAniListId) && normalizedAniListId > 0) {
    params.set('anilist_id', String(normalizedAniListId));
  }

  return params.toString();
}

export async function fetchAniZipEpisodes(ids, { cacheTtlMs = 2 * 60 * 1000, key } = {}) {
  const query = buildAniZipQuery(typeof ids === 'object' && ids !== null ? ids : { anilistId: ids });
  if (!query) return [];

  const payload = await pacedJsonFetch(apiUrl(`/api/anizip?${query}`), undefined, {
    key: key || `anizip:${query}`,
    cacheTtlMs,
  });

  return normalizeAniZipEpisodes(payload);
}

export async function hydrateMediaWithAniZipEpisodeCounts(mediaList, { limit = 12, cacheTtlMs = 2 * 60 * 1000, keyPrefix = 'anizip-hydrate' } = {}) {
  if (!Array.isArray(mediaList) || mediaList.length === 0) return mediaList || [];

  const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 12;
  const next = mediaList.map((item) => ({ ...item }));

  const missingEpisodeTargets = next
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item?.episodes && (item?.idMal || item?.id))
    .slice(0, normalizedLimit);

  if (missingEpisodeTargets.length === 0) return next;

  const lookups = await Promise.allSettled(
    missingEpisodeTargets.map(async ({ item, index }) => {
      const episodes = await fetchAniZipEpisodes(
        { malId: item.idMal, anilistId: item.id },
        {
          cacheTtlMs,
          key: `${keyPrefix}:${item.idMal || 'x'}:${item.id || 'x'}`,
        }
      );

      return {
        index,
        episodeCount: episodes.length || null,
      };
    })
  );

  lookups.forEach((result) => {
    if (result.status !== 'fulfilled') return;
    const { index, episodeCount } = result.value;
    if (!episodeCount) return;
    next[index] = { ...next[index], episodes: episodeCount };
  });

  return next;
}
