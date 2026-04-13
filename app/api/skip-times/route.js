import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

// Mock skip times for testing purposes
const MOCK_SKIP_TIMES = {
  '40748': { // Jujutsu Kaisen
    '1': { intro: { startTime: 30, endTime: 90 }, outro: { startTime: 1320, endTime: 1380 } },
  },
  '59145': { // Ranma 1/2 - for testing
    '1': { intro: { startTime: 20, endTime: 85 }, outro: { startTime: 1300, endTime: 1380 } },
    '2': { intro: { startTime: 20, endTime: 85 }, outro: { startTime: 1300, endTime: 1380 } },
  }
};

const OP_TYPES = new Set(['op', 'mixed-op']);
const ED_TYPES = new Set(['ed', 'mixed-ed']);

async function loadLocalSkipTimes() {
  try {
    const configPath = path.join(process.cwd(), 'skip-times-config.json');
    const data = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(data);
    console.log(`[SkipTimes] Loaded local config with ${Object.keys(config).filter(k => k !== 'comment').length} anime`);
    return config;
  } catch (e) {
    if (e?.code !== 'ENOENT') {
      console.log('[SkipTimes] Error reading local config:', e.message);
    }
    return {};
  }
}

function parsePositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

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
    autoOffset: offset !== 0 ? offset : undefined
  };
}

function uniquePositiveInts(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const n = Number.parseInt(String(value), 10);
    if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function pickBestByDuration(results, requestedLengthSec) {
  if (!results.length) return null;
  if (!requestedLengthSec) return results[0];

  const withLength = results.filter(r => r.episodeLength);
  if (!withLength.length) return results[0];

  let best = withLength[0];
  let bestDiff = Math.abs(withLength[0].episodeLength - requestedLengthSec);
  for (let i = 1; i < withLength.length; i += 1) {
    const diff = Math.abs(withLength[i].episodeLength - requestedLengthSec);
    if (diff < bestDiff) {
      best = withLength[i];
      bestDiff = diff;
    }
  }
  return best;
}

async function fetchAniSkip(malId, episode, episodeLengthSec) {
  const aniskipUrl = new URL(`https://api.aniskip.com/v2/skip-times/${malId}/${episode}`);
  aniskipUrl.searchParams.append('types', 'op');
  aniskipUrl.searchParams.append('types', 'ed');
  aniskipUrl.searchParams.append('types', 'mixed-op');
  aniskipUrl.searchParams.append('types', 'mixed-ed');
  aniskipUrl.searchParams.append('types', 'recap');
  aniskipUrl.searchParams.append('episodeLength', String(episodeLengthSec || 0));

  const res = await fetch(aniskipUrl.toString(), {
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    return { found: false, results: [] };
  }

  const payload = await res.json();
  const normalized = Array.isArray(payload?.results)
    ? payload.results.map(normalizeResult).filter(Boolean)
    : [];

  return {
    found: Boolean(payload?.found) && normalized.length > 0,
    results: normalized,
  };
}

function buildSkipTimesFromResults(results, requestedLengthSec) {
  const introCandidates = results.filter(r => OP_TYPES.has(r.skipType));
  const outroCandidates = results.filter(r => ED_TYPES.has(r.skipType));
  const recapCandidates = results.filter(r => r.skipType === 'recap');

  const intro = pickBestByDuration(introCandidates, requestedLengthSec);
  const outro = pickBestByDuration(outroCandidates, requestedLengthSec);
  const recap = pickBestByDuration(recapCandidates, requestedLengthSec);

  const getOffset = (bestCandidatesResult) => {
    // If we have a requested length and the best result has an episodeLength
    if (requestedLengthSec && bestCandidatesResult && bestCandidatesResult.episodeLength) {
        const diff = requestedLengthSec - bestCandidatesResult.episodeLength;
        // If the duration difference is small (e.g. up to 10 seconds), 
        // it's almost always a splash screen / ad bumper added or missing at the START of the video.
        // By shifting the start time exactly by the length difference, we sync AniSkip back up.
        if (Math.abs(diff) <= 10) {
            return diff;
        }
    }
    return 0;
  };

  const skipTimes = {
    intro: asSkipSegment(intro, 'intro', getOffset(intro)),
    outro: asSkipSegment(outro, 'outro', getOffset(outro)),
    recap: asSkipSegment(recap, 'recap', getOffset(recap)),
  };

  return Object.fromEntries(Object.entries(skipTimes).filter(([, v]) => v));
}

function scoreSkipTimes(skipTimes, requestedLengthSec, results) {
  let score = 0;
  if (skipTimes.intro) score += 25;
  if (skipTimes.outro) score += 25;
  if (skipTimes.recap) score += 8;

  if (!requestedLengthSec) return score;

  const lengths = results
    .map(r => r.episodeLength)
    .filter(v => Number.isFinite(v) && v > 0);
  if (lengths.length) {
    const minDiff = Math.min(...lengths.map(v => Math.abs(v - requestedLengthSec)));
    score += Math.max(0, 30 - (minDiff / 5));
  }

  if (skipTimes.intro) {
    const introRatio = skipTimes.intro.startTime / requestedLengthSec;
    if (introRatio <= 0.2) score += 8;
    else if (introRatio <= 0.4) score += 4;
    else score -= 4;
  }

  if (skipTimes.outro) {
    const outroRatio = skipTimes.outro.startTime / requestedLengthSec;
    if (outroRatio >= 0.75) score += 8;
    else if (outroRatio >= 0.6) score += 4;
    else score -= 4;
  }

  return score;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const malId = searchParams.get('malId');
  const episode = searchParams.get('episode');
  const episodeLength = parsePositiveNumber(searchParams.get('episodeLength'));
  const candidateMalIdsParam = searchParams.get('candidateMalIds') || '';
  const useMock = searchParams.get('mock') === 'true';

  if (!malId || !episode) {
    return NextResponse.json({ error: 'Missing malId or episode' }, { status: 400 });
  }

  try {
    const episodeNum = Number.parseInt(episode, 10);
    const primaryMalId = Number.parseInt(malId, 10);
    const candidateIds = uniquePositiveInts([
      primaryMalId,
      ...candidateMalIdsParam.split(',').map(v => v.trim()).filter(Boolean),
    ]);

    const localConfig = await loadLocalSkipTimes();

    if (useMock) {
      const mock = MOCK_SKIP_TIMES?.[String(primaryMalId)]?.[String(episodeNum)] || null;
      if (mock) {
        return NextResponse.json({
          skipTimes: mock,
          source: 'mock',
          resolvedMalId: primaryMalId,
        });
      }
    }

    for (const id of candidateIds) {
      const localHit = localConfig?.[String(id)]?.[String(episodeNum)];
      if (localHit) {
        return NextResponse.json({
          skipTimes: localHit,
          source: 'local-config',
          resolvedMalId: id,
        });
      }
    }

    let best = null;

    for (const id of candidateIds) {
      let apiResult = await fetchAniSkip(id, episodeNum, episodeLength);

      if (!apiResult.found && episodeLength) {
        apiResult = await fetchAniSkip(id, episodeNum, 0);
      }
      if (!apiResult.found) continue;

      const skipTimes = buildSkipTimesFromResults(apiResult.results, episodeLength);
      if (!Object.keys(skipTimes).length) continue;

      const score = scoreSkipTimes(skipTimes, episodeLength, apiResult.results);
      if (!best || score > best.score) {
        best = { id, skipTimes, score };
      }
    }

    if (!best) {
      return NextResponse.json({
        skipTimes: null,
        source: 'none',
        resolvedMalId: primaryMalId,
      });
    }

    return NextResponse.json({
      skipTimes: best.skipTimes,
      source: 'aniskip',
      resolvedMalId: best.id,
    });

  } catch (error) {
    console.error('[SkipTimes] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch skip times' }, { status: 500 });
  }
}