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

async function fetchAniSkipRules(malId) {
  const endpoint = `https://api.aniskip.com/v2/relation-rules/${malId}`;
  const response = await fetchWithTimeout(
    endpoint,
    { headers: { Accept: 'application/json' } },
    15000,
  );

  if (!response.ok) {
    return [];
  }

  const payload = await response.json();
  return payload?.found && Array.isArray(payload.rules) ? payload.rules : [];
}

async function applyRelationRules(malId, episodeNumber) {
  let currentMalId = malId;
  let currentEpisodeNumber = episodeNumber;

  const rules = await fetchAniSkipRules(currentMalId);

  for (const rule of rules) {
    const start = rule.from.start;
    const end = rule.from.end || Infinity;
    const toMalId = rule.to.malId;

    // Handle seasons with multiple parts and continuous counting.
    // (Ported exactly from the official extension's base-page.ts)
    if (currentMalId === toMalId && currentEpisodeNumber > end) {
      const seasonLength = end - (start - 1);
      const episodeOverflow = currentEpisodeNumber - end;
      currentEpisodeNumber = episodeOverflow + seasonLength;
    }

    if (currentEpisodeNumber >= start && currentEpisodeNumber <= end) {
      currentMalId = toMalId;
      currentEpisodeNumber = currentEpisodeNumber - (start - 1);
      break; // Found the mapping, no need to process other rules
    }
  }

  return { resolvedMalId: currentMalId, resolvedEpisode: currentEpisodeNumber };
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
  const episodeHalf = (requestedLengthSec || 1440) / 2;

  const validTypes = new Set([...openingTypes, ...endingTypes]);

  // If a song plays in the first half of the episode, treat it as the Intro
  const intro = pickBestByDuration(
    results.filter((result) => validTypes.has(result.skipType) && Number(result.startTime) < episodeHalf),
    requestedLengthSec,
  );

  // If a song plays in the second half of the episode, treat it as the Outro
  const outro = pickBestByDuration(
    results.filter((result) => validTypes.has(result.skipType) && Number(result.startTime) >= episodeHalf),
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

export async function handleSkipTimes({ req, res, url }) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, OPTIONS' });
  }

  const malId = url.searchParams.get('malId');
  const anilistId = url.searchParams.get('anilistId');
  const episode = url.searchParams.get('episode');
  const episodeLength = parsePositiveNumber(url.searchParams.get('episodeLength'));
  const useMock = url.searchParams.get('mock') === 'true';

  if (!malId || !episode) {
    return sendJson(res, 400, { error: 'Missing malId or episode' });
  }

  try {
    const episodeNumber = Number.parseInt(episode, 10);
    const primaryMalId = Number.parseInt(malId, 10);

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

    const { resolvedMalId, resolvedEpisode } = await applyRelationRules(primaryMalId, episodeNumber);
    const best = await resolveSkipTimesForId(resolvedMalId, resolvedEpisode, episodeLength);

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
      resolvedMalId: best.id,
    });
  } catch (error) {
    console.error('[skip-times] Error:', error);
    return sendJson(res, 500, { error: 'Failed to fetch skip times' });
  }
}
