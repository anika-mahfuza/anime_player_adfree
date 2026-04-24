import {
  fetchWithTimeout,
  parsePositiveNumber,
  sendJson,
  uniquePositiveIntegers,
} from './http.js';

const mockSkipTimes = {
  '40748': {
    '1': { intro: { startTime: 30, endTime: 90 }, outro: { startTime: 1320, endTime: 1380 } },
  },
  '59145': {
    '1': { intro: { startTime: 20, endTime: 85 }, outro: { startTime: 1300, endTime: 1380 } },
    '2': { intro: { startTime: 20, endTime: 85 }, outro: { startTime: 1300, endTime: 1380 } },
  },
};

const openingTypes = new Set(['op', 'mixed-op']);
const endingTypes = new Set(['ed', 'mixed-ed']);
const animeSkipIntroTypes = ['Intro', 'Mixed Intro', 'New Intro'];
const animeSkipOutroTypes = ['Credits', 'Mixed Credits', 'New Credits'];
const animeSkipTimeoutMs = 30000;

function normalizeResult(result) {
  const start = Number(result?.interval?.startTime ?? result?.interval?.start_time);
  const end = Number(result?.interval?.endTime ?? result?.interval?.end_time);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

  return {
    skipType: String(result?.skipType ?? '').toLowerCase(),
    startTime: start,
    endTime: end,
    episodeLength: parsePositiveNumber(result?.episodeLength),
  };
}

function clampToEpisodeLength(value, requestedLengthSec) {
  const safe = Math.max(0, value);
  if (!requestedLengthSec) return safe;
  return Math.min(safe, requestedLengthSec);
}

function normalizeSegmentWindow(result, type, requestedLengthSec) {
  if (!result) return null;

  const providerLength = parsePositiveNumber(result?.episodeLength);
  const rawStart = Number(result.startTime);
  const rawEnd = Number(result.endTime);

  if (!requestedLengthSec || !providerLength || providerLength <= 0) {
    return {
      startTime: Number(Math.max(0, rawStart).toFixed(3)),
      endTime: Number(Math.max(0, rawEnd).toFixed(3)),
      type,
    };
  }

  const segmentLength = rawEnd - rawStart;
  if (!Number.isFinite(segmentLength) || segmentLength <= 0) {
    return null;
  }

  const diff = requestedLengthSec - providerLength;
  const midpointRatio = ((rawStart + rawEnd) / 2) / providerLength;
  const durationRatio = requestedLengthSec / providerLength;
  const distanceFromEnd = providerLength - rawEnd;

  let startTime = rawStart;
  let endTime = rawEnd;
  let alignment = 'start';

  if (Math.abs(diff) < 10) {
    // If the difference is small, it's likely just trimmed black screens. Do not shift.
    alignment = 'start';
  } else if (type === 'outro' || midpointRatio >= 0.7) {
    endTime = requestedLengthSec - distanceFromEnd;
    startTime = endTime - segmentLength;
    alignment = 'end';
  } else if (type === 'recap' || (midpointRatio > 0.3 && midpointRatio < 0.7)) {
    startTime = rawStart * durationRatio;
    endTime = rawEnd * durationRatio;
    alignment = 'scale';
  }

  startTime = clampToEpisodeLength(startTime, requestedLengthSec);
  endTime = clampToEpisodeLength(endTime, requestedLengthSec);

  if (endTime <= startTime) {
    return null;
  }

  return {
    startTime: Number(startTime.toFixed(3)),
    endTime: Number(endTime.toFixed(3)),
    type,
    alignment,
    autoOffset: alignment === 'end' && diff !== 0 ? Number(diff.toFixed(3)) : undefined,
    autoScale: alignment === 'scale' ? Number(durationRatio.toFixed(4)) : undefined,
    providerEpisodeLength: providerLength,
  };
}

function pickBestByDuration(results, requestedLengthSec) {
  if (!results.length) return null;
  if (!requestedLengthSec) return results[0];

  const withLength = results.filter((result) => result.episodeLength);
  if (!withLength.length) return results[0];

  return withLength.reduce((best, current) => {
    const bestDiff = Math.abs(best.episodeLength - requestedLengthSec);
    const currentDiff = Math.abs(current.episodeLength - requestedLengthSec);
    return currentDiff < bestDiff ? current : best;
  });
}

async function fetchAniSkip(malId, episode, episodeLengthSec) {
  const endpoint = new URL(`https://api.aniskip.com/v2/skip-times/${malId}/${episode}`);
  endpoint.searchParams.append('types', 'op');
  endpoint.searchParams.append('types', 'ed');
  endpoint.searchParams.append('types', 'mixed-op');
  endpoint.searchParams.append('types', 'mixed-ed');
  endpoint.searchParams.append('types', 'recap');
  endpoint.searchParams.append('episodeLength', String(episodeLengthSec || 0));

  const response = await fetchWithTimeout(
    endpoint.toString(),
    { headers: { Accept: 'application/json' } },
    15000,
  );

  if (!response.ok) {
    return { found: false, results: [] };
  }

  const payload = await response.json();
  const normalized = Array.isArray(payload?.results)
    ? payload.results.map(normalizeResult).filter(Boolean)
    : [];

  return {
    found: Boolean(payload?.found) && normalized.length > 0,
    results: normalized,
  };
}

async function fetchAnimeSkipShows(anilistId) {
  const query = `
    query ($serviceId: String!) {
      findShowsByExternalId(service: ANILIST, serviceId: $serviceId) {
        id
        name
        episodeCount
        episodes {
          id
          season
          number
          name
          timestamps {
            at
            type { name }
          }
        }
      }
    }
  `;

  let response;
  try {
    response = await fetchWithTimeout(
      'https://api.anime-skip.com/graphql',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Client-ID': 'ZGfO0sMF3eCwLYf8yMSCJjlynwNGRXWE',
        },
        body: JSON.stringify({ query, variables: { serviceId: String(anilistId) } }),
      },
      animeSkipTimeoutMs,
    );
  } catch (error) {
    console.warn(`[skip-times] Anime-Skip lookup failed for AniList ${anilistId}: ${error.message}`);
    return [];
  }

  if (!response.ok) {
    return [];
  }

  const payload = await response.json();
  return Array.isArray(payload?.data?.findShowsByExternalId)
    ? payload.data.findShowsByExternalId
    : [];
}

function collectAnimeSkipSegments(timestamps, allowedNames, episodeLength) {
  const ordered = timestamps
    .map((timestamp) => ({
      at: Number(timestamp?.at),
      typeName: String(timestamp?.type?.name || ''),
    }))
    .filter((timestamp) => Number.isFinite(timestamp.at))
    .sort((a, b) => a.at - b.at);

  const segments = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index];
    if (!allowedNames.includes(current.typeName)) continue;

    const next = ordered[index + 1];
    const start = current.at;
    const end = next?.at ?? episodeLength;

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    segments.push({ startTime: start, endTime: end });
  }

  return segments;
}

function pickLongestSegment(segments) {
  if (!segments.length) return null;
  return segments.reduce((best, current) => (
    (current.endTime - current.startTime) > (best.endTime - best.startTime) ? current : best
  ));
}

function scoreAnimeSkipShow(show, episodeNumber) {
  const episode = (show?.episodes || []).find((item) => Number.parseInt(item?.number, 10) === episodeNumber);
  if (!episode) return -1;

  let score = 0;
  if (episode.timestamps?.length) score += 40;
  if (show?.episodeCount) score += Math.min(show.episodeCount, 20);
  if (show?.name) score += 5;
  return score;
}

function countResolvedSegments(skipTimes) {
  let count = 0;
  if (skipTimes?.intro) count += 1;
  if (skipTimes?.outro) count += 1;
  if (skipTimes?.recap) count += 1;
  return count;
}

function compareResolvedCandidates(next, current) {
  if (!next) return current;
  if (!current) return next;

  return next.score > current.score ? next : current;
}

function buildSkipTimes(results, requestedLengthSec) {
  const intro = pickBestByDuration(
    results.filter((result) => openingTypes.has(result.skipType)),
    requestedLengthSec,
  );
  const outro = pickBestByDuration(
    results.filter((result) => endingTypes.has(result.skipType)),
    requestedLengthSec,
  );
  const recap = pickBestByDuration(
    results.filter((result) => result.skipType === 'recap'),
    requestedLengthSec,
  );

  return Object.fromEntries(
    Object.entries({
      intro: normalizeSegmentWindow(intro, 'intro', requestedLengthSec),
      outro: normalizeSegmentWindow(outro, 'outro', requestedLengthSec),
      recap: normalizeSegmentWindow(recap, 'recap', requestedLengthSec),
    }).filter(([, value]) => value),
  );
}

function scoreSkipTimes(skipTimes, requestedLengthSec, results) {
  let score = 0;
  
  const addLengthScore = (segment) => {
    if (segment && segment.providerEpisodeLength && requestedLengthSec) {
      const diff = Math.abs(segment.providerEpisodeLength - requestedLengthSec);
      score += Math.max(0, 15 - diff / 2); // max 15 per segment
    } else if (segment) {
      score += 5;
    }
  };

  if (skipTimes.intro) {
    score += 25;
    addLengthScore(skipTimes.intro);
    const ratio = skipTimes.intro.startTime / (requestedLengthSec || 1440);
    score += ratio <= 0.25 ? 8 : ratio <= 0.45 ? 4 : -4;
  }

  if (skipTimes.outro) {
    score += 25;
    addLengthScore(skipTimes.outro);
    const ratio = skipTimes.outro.startTime / (requestedLengthSec || 1440);
    score += ratio >= 0.75 ? 8 : ratio >= 0.6 ? 4 : -4;
  }
  
  if (skipTimes.recap) {
    score += 8;
  }

  return score;
}

async function resolveSkipTimesForId(malId, episodeNumber, episodeLength) {
  let result = await fetchAniSkip(malId, episodeNumber, episodeLength);
  if (!result.found && episodeLength) {
    result = await fetchAniSkip(malId, episodeNumber, 0);
  }
  if (!result.found) return null;

  const skipTimes = buildSkipTimes(result.results, episodeLength);
  if (!Object.keys(skipTimes).length) return null;

  return {
    id: malId,
    skipTimes,
    source: 'aniskip',
    score: scoreSkipTimes(skipTimes, episodeLength, result.results),
  };
}

async function resolveAnimeSkipForId(anilistId, episodeNumber, episodeLength) {
  if (!anilistId) return null;

  const shows = await fetchAnimeSkipShows(anilistId);
  if (!shows.length) return null;

  const bestShow = shows.reduce((best, current) => {
    if (!best) return current;
    return scoreAnimeSkipShow(current, episodeNumber) > scoreAnimeSkipShow(best, episodeNumber) ? current : best;
  }, null);

  const matchingEpisodes = (bestShow?.episodes || []).filter(
    (item) => Number.parseInt(item?.number, 10) === episodeNumber,
  );
  if (!matchingEpisodes.length) return null;

  let bestResolved = null;

  for (const episode of matchingEpisodes) {
    if (!episode?.timestamps?.length) continue;

    const referenceLength = episode.timestamps
      .map((timestamp) => Number(timestamp?.at))
      .filter((value) => Number.isFinite(value))
      .reduce((max, value) => Math.max(max, value), 0);

    const introSegment = pickLongestSegment(collectAnimeSkipSegments(episode.timestamps, animeSkipIntroTypes, referenceLength));
    const outroSegment = pickLongestSegment(collectAnimeSkipSegments(episode.timestamps, animeSkipOutroTypes, referenceLength));

    const skipTimes = Object.fromEntries(
      Object.entries({
        intro: introSegment
          ? normalizeSegmentWindow({ ...introSegment, episodeLength: referenceLength || undefined }, 'intro', episodeLength)
          : null,
        outro: outroSegment
          ? normalizeSegmentWindow({ ...outroSegment, episodeLength: referenceLength || undefined }, 'outro', episodeLength)
          : null,
      }).filter(([, value]) => value),
    );

    if (!Object.keys(skipTimes).length) continue;

    const score =
      (skipTimes.intro ? 30 : 0) +
      (skipTimes.outro ? 30 : 0) +
      (skipTimes.recap ? 10 : 0) +
      Math.min(bestShow?.episodeCount || 0, 20) +
      scoreSkipTimes(skipTimes, episodeLength);

    const resolved = { id: anilistId, skipTimes, source: 'anime-skip', score };
    bestResolved = compareResolvedCandidates(resolved, bestResolved);
  }

  return bestResolved;
}


export async function handleSkipTimes({ req, res, url }) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, OPTIONS' });
  }

  const malId = url.searchParams.get('malId');
  const anilistId = url.searchParams.get('anilistId');
  const episode = url.searchParams.get('episode');
  const episodeLength = parsePositiveNumber(url.searchParams.get('episodeLength'));
  const candidateMalIdsParam = url.searchParams.get('candidateMalIds') || '';
  const candidateAnilistIdsParam = url.searchParams.get('candidateAnilistIds') || '';
  const useMock = url.searchParams.get('mock') === 'true';

  if (!malId || !episode) {
    return sendJson(res, 400, { error: 'Missing malId or episode' });
  }

  try {
    const episodeNumber = Number.parseInt(episode, 10);
    const primaryMalId = Number.parseInt(malId, 10);
    const candidateIds = uniquePositiveIntegers([
      primaryMalId,
      ...candidateMalIdsParam.split(',').map((value) => value.trim()).filter(Boolean),
    ]);
    const primaryAnilistId = Number.parseInt(String(anilistId || ''), 10);
    const candidateAnilistIds = uniquePositiveIntegers([
      primaryAnilistId,
      ...candidateAnilistIdsParam.split(',').map((value) => value.trim()).filter(Boolean),
    ]);

    if (useMock) {
      const mock = mockSkipTimes?.[String(primaryMalId)]?.[String(episodeNumber)] || null;
      if (mock) {
        return sendJson(res, 200, {
          skipTimes: mock,
          source: 'mock',
          resolvedMalId: primaryMalId,
        });
      }
    }

    let best = null;

    const primary = await resolveSkipTimesForId(primaryMalId, episodeNumber, episodeLength);
    best = compareResolvedCandidates(primary, best);

    // Some sites offset episode numbers (e.g. treating a recap as ep 1, or shifting after it)
    if (episodeLength) {
      if (episodeNumber > 0) {
        const prev = await resolveSkipTimesForId(primaryMalId, episodeNumber - 1, episodeLength);
        best = compareResolvedCandidates(prev, best);
      }
      const next = await resolveSkipTimesForId(primaryMalId, episodeNumber + 1, episodeLength);
      best = compareResolvedCandidates(next, best);
    }

    for (const id of candidateIds) {
      if (id === primaryMalId) continue;
      const resolved = await resolveSkipTimesForId(id, episodeNumber, episodeLength);
      best = compareResolvedCandidates(resolved, best);
    }

    let bestAnimeSkip = null;

    for (const id of candidateAnilistIds) {
      const resolved = await resolveAnimeSkipForId(id, episodeNumber, episodeLength);
      if (!resolved) continue;
      if (!bestAnimeSkip || resolved.score > bestAnimeSkip.score) {
        bestAnimeSkip = resolved;
      }
      if (id === primaryAnilistId && countResolvedSegments(resolved.skipTimes) >= 2) {
        break;
      }
    }

    best = compareResolvedCandidates(bestAnimeSkip, best);

    if (!best) {
      return sendJson(res, 200, {
        skipTimes: null,
        source: 'none',
        resolvedMalId: primaryMalId,
      });
    }

    return sendJson(res, 200, {
      skipTimes: best.skipTimes,
      source: best.source,
      resolvedMalId: best.source === 'aniskip' ? best.id : primaryMalId,
      resolvedAnilistId: best.source === 'anime-skip' ? best.id : undefined,
    });
  } catch (error) {
    console.error('[skip-times] Error:', error);
    return sendJson(res, 500, { error: 'Failed to fetch skip times' });
  }
}
