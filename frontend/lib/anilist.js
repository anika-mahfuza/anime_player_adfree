import { apiUrl } from '@/lib/apiBase';
import { fetchJikanAnimeMetadataBatch } from '@/lib/jikan';
import { scheduleRequest } from '@/lib/requestScheduler';

export const MIN_SKELETON_MS = 650;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensureMinimumDelay(startedAt, minMs = MIN_SKELETON_MS) {
  const remaining = Math.max(0, minMs - (Date.now() - startedAt));
  if (remaining > 0) {
    await wait(remaining);
  }
}

export async function anilistRequest(query, variables = {}, { cacheTtlMs = 0, key } = {}) {
  const requestKey = key || `anilist:${query}:${JSON.stringify(variables)}`;

  return scheduleRequest(async () => {
    const response = await fetch(apiUrl('/api/anilist'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const error = new Error(response.status === 429 ? 'Rate limited. Please wait a moment and try again.' : `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }

    const payload = await response.json();
    if (payload.errors?.length) {
      throw new Error(payload.errors[0].message || 'AniList request failed');
    }

    return payload.data;
  }, { key: requestKey, cacheTtlMs });
}

export async function fetchAnimeMetadataBatch(ids) {
  const normalizedIds = [...new Set(ids.map((id) => Number.parseInt(id, 10)).filter(Boolean))];
  if (normalizedIds.length === 0) return [];

  const fields = normalizedIds
    .map((id, index) => `
      item${index}: Media(id: ${id}, type: ANIME) {
        id
        title { romaji english }
        coverImage { large }
        episodes
      }
    `)
    .join('\n');

  try {
    const data = await anilistRequest(`query {\n${fields}\n}`, {}, {
      cacheTtlMs: 10 * 60 * 1000,
      key: `anilist:metadata-batch:${normalizedIds.join(',')}`,
    });

    return normalizedIds
      .map((_, index) => data?.[`item${index}`] || null)
      .filter(Boolean);
  } catch {
    return fetchJikanAnimeMetadataBatch(normalizedIds, {
      cacheTtlMs: 10 * 60 * 1000,
    });
  }
}
