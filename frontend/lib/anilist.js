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

  const query = `
    query($in: [Int]) {
      Page(page: 1, perPage: 50) {
        media(id_in: $in, type: ANIME) {
          id
          title { romaji english }
          coverImage { large }
          episodes
        }
      }
    }
  `;

  try {
    const data = await anilistRequest(query, { in: normalizedIds }, {
      cacheTtlMs: 10 * 60 * 1000,
      key: `anilist:metadata-batch:${normalizedIds.join(',')}`,
    });

    const anilistResults = data?.Page?.media || [];
    
    // If some IDs weren't found in AniList, they might be Jikan/MAL IDs from a previous fallback
    const foundIds = new Set(anilistResults.map((item) => item.id));
    const missingIds = normalizedIds.filter((id) => !foundIds.has(id));
    
    if (missingIds.length > 0) {
      try {
        const jikanFallback = await fetchJikanAnimeMetadataBatch(missingIds, { cacheTtlMs: 10 * 60 * 1000 });
        return [...anilistResults, ...jikanFallback];
      } catch {
        return anilistResults;
      }
    }

    return anilistResults;
  } catch {
    // If AniList proxy is completely down, try Jikan for everything
    return fetchJikanAnimeMetadataBatch(normalizedIds, {
      cacheTtlMs: 10 * 60 * 1000,
    });
  }
}
