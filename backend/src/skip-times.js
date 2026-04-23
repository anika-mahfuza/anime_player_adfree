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

function asSkipSegment(result, type, offset = 0) {
  if (!result) return null;

  return {
    startTime: Number((Math.max(0, result.startTime + offset)).toFixed(3)),
    endTime: Number((Math.max(0, result.endTime + offset)).toFixed(3)),
    type,
    autoOffset: offset !== 0 ? offset : undefined,
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

  const getOffset = (bestResult) => {
    if (!requestedLengthSec || !bestResult?.episodeLength) return 0;
    const diff = requestedLengthSec - bestResult.episodeLength;
    return Math.abs(diff) <= 10 ? diff : 0;
  };

  return Object.fromEntries(
    Object.entries({
      intro: asSkipSegment(intro, 'intro', getOffset(intro)),
      outro: asSkipSegment(outro, 'outro', getOffset(outro)),
      recap: asSkipSegment(recap, 'recap', getOffset(recap)),
    }).filter(([, value]) => value),
  );
}

function scoreSkipTimes(skipTimes, requestedLengthSec, results) {
  let score = 0;
  if (skipTimes.intro) score += 25;
  if (skipTimes.outro) score += 25;
  if (skipTimes.recap) score += 8;

  if (!requestedLengthSec) return score;

  const lengths = results
    .map((result) => result.episodeLength)
    .filter((value) => Number.isFinite(value) && value > 0);

  if (lengths.length) {
    const minDiff = Math.min(...lengths.map((value) => Math.abs(value - requestedLengthSec)));
    score += Math.max(0, 30 - minDiff / 5);
  }

  if (skipTimes.intro) {
    const ratio = skipTimes.intro.startTime / requestedLengthSec;
    score += ratio <= 0.2 ? 8 : ratio <= 0.4 ? 4 : -4;
  }

  if (skipTimes.outro) {
    const ratio = skipTimes.outro.startTime / requestedLengthSec;
    score += ratio >= 0.75 ? 8 : ratio >= 0.6 ? 4 : -4;
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
    score: scoreSkipTimes(skipTimes, episodeLength, result.results),
  };
}

export async function handleSkipTimes({ req, res, url }) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, OPTIONS' });
  }

  const malId = url.searchParams.get('malId');
  const episode = url.searchParams.get('episode');
  const episodeLength = parsePositiveNumber(url.searchParams.get('episodeLength'));
  const candidateMalIdsParam = url.searchParams.get('candidateMalIds') || '';
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

    const primary = await resolveSkipTimesForId(primaryMalId, episodeNumber, episodeLength);
    if (primary) {
      return sendJson(res, 200, {
        skipTimes: primary.skipTimes,
        source: 'aniskip',
        resolvedMalId: primary.id,
      });
    }

    let best = null;

    for (const id of candidateIds) {
      if (id === primaryMalId) continue;
      const resolved = await resolveSkipTimesForId(id, episodeNumber, episodeLength);
      if (!resolved) continue;
      if (!best || resolved.score > best.score) {
        best = resolved;
      }
    }

    if (!best) {
      return sendJson(res, 200, {
        skipTimes: null,
        source: 'none',
        resolvedMalId: primaryMalId,
      });
    }

    return sendJson(res, 200, {
      skipTimes: best.skipTimes,
      source: 'aniskip',
      resolvedMalId: best.id,
    });
  } catch (error) {
    console.error('[skip-times] Error:', error);
    return sendJson(res, 500, { error: 'Failed to fetch skip times' });
  }
}
