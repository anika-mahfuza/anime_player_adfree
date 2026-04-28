import { mediaTitle } from './media.js';

const MAL_ID_PATTERN = /\bmal\D*(\d{1,7})\b/i;
const MAL_TOKEN_STRIP = /\(.*?\bmal\D*\d{1,7}\b.*?\)|\bmal\D*\d{1,7}\b/gi;
const FORMAT_TOKENS = new Set(['tv', 'movie', 'ova', 'ona', 'special', 'music']);

const ALIAS_MAP = new Map([
  ['nge', 'neon genesis evangelion'],
  ['eva', 'neon genesis evangelion'],
  ['snk', 'shingeki no kyojin'],
  ['aot', 'attack on titan'],
  ['fmab', 'fullmetal alchemist brotherhood'],
]);

function toNumber(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function normalizeForCompare(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeNormalized(text) {
  return normalizeForCompare(text).split(' ').filter(Boolean);
}

function levenshteinDistance(a, b, maxDistance = 2) {
  if (a === b) return 0;
  if (!a || !b) return Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  const previous = new Array(b.length + 1);
  const current = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) previous[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let minInRow = current[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
      if (current[j] < minInRow) minInRow = current[j];
    }
    if (minInRow > maxDistance) return maxDistance + 1;
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

function fuzzyTokenMatch(queryTokens, titleTokens) {
  if (queryTokens.length === 0 || titleTokens.length === 0) return 0;

  let matched = 0;
  for (const queryToken of queryTokens) {
    if (queryToken.length < 5) continue;
    const isMatched = titleTokens.some((token) => {
      if (token.length < 5) return false;
      if (queryToken[0] !== token[0]) return false;
      const maxDistance = queryToken.length >= 8 ? 2 : 1;
      return levenshteinDistance(queryToken, token, maxDistance) <= maxDistance;
    });
    if (isMatched) matched += 1;
  }
  return matched;
}

function titleCandidates(media) {
  return [
    media?.title?.english,
    media?.title?.romaji,
    media?.title?.native,
    mediaTitle(media),
  ]
    .map(normalizeForCompare)
    .filter(Boolean);
}

export function mediaIdentity(media, index = 0) {
  if (media?.id != null) return `id-${media.id}`;
  if (media?.idMal != null) return `mal-${media.idMal}`;
  const normalizedTitle = normalizeForCompare(mediaTitle(media));
  return normalizedTitle ? `title-${normalizedTitle}` : `idx-${index}`;
}

export function parseUserSearchQuery(term) {
  const raw = String(term || '').trim();
  const malIdMatch = raw.match(MAL_ID_PATTERN);
  const malId = malIdMatch ? Number.parseInt(malIdMatch[1], 10) : null;

  const canonical = raw.replace(MAL_TOKEN_STRIP, '').trim() || raw;
  const normalized = normalizeForCompare(canonical);
  const tokens = tokenizeNormalized(canonical);
  const preferredFormats = tokens.filter((token) => FORMAT_TOKENS.has(token));

  const aliasExpansion = ALIAS_MAP.get(normalized) || null;
  const normalizedAlias = aliasExpansion ? normalizeForCompare(aliasExpansion) : null;
  const queryVariants = new Set([normalized]);
  if (normalizedAlias) queryVariants.add(normalizedAlias);

  const expandedTokens = new Set(tokens);
  if (normalizedAlias) {
    tokenizeNormalized(normalizedAlias).forEach((token) => expandedTokens.add(token));
  }

  return {
    raw,
    canonical,
    normalized,
    malId,
    tokens,
    expandedTokens: [...expandedTokens],
    preferredFormats,
    aliasExpansion,
    queryVariants: [...queryVariants].filter(Boolean),
  };
}

function rankOne(queryInfo, media, { allowFuzzy }) {
  const titles = titleCandidates(media);
  const queryVariants = queryInfo.queryVariants;
  const queryTokenSet = queryInfo.expandedTokens;
  const format = normalizeForCompare(media?.format);

  let bestTier = 4;
  let bestScore = 0;
  let exact = false;

  for (const title of titles) {
    const titleTokens = tokenizeNormalized(title);
    const tokenOverlap = queryTokenSet.filter((token) => titleTokens.includes(token)).length;
    const variantExact = queryVariants.includes(title);
    const variantPrefix = queryVariants.some((variant) => variant && title.startsWith(variant));
    const variantContains = queryVariants.some((variant) => variant && title.includes(variant));
    const allWordsPresent = queryTokenSet.length > 0 && queryTokenSet.every((token) => titleTokens.includes(token));

    let tier = 4;
    let score = 0;

    if (variantExact) {
      tier = 0;
      score += 600;
      exact = true;
    } else if (variantPrefix) {
      tier = 1;
      score += 430;
    } else if (variantContains || allWordsPresent) {
      tier = 2;
      score += 280;
    } else if (tokenOverlap > 0) {
      tier = 3;
      score += 150 + (tokenOverlap * 22);
    }

    if (allowFuzzy && tier === 4) {
      const fuzzyMatches = fuzzyTokenMatch(queryTokenSet, titleTokens);
      if (fuzzyMatches > 0) {
        tier = 3;
        score += 120 + (fuzzyMatches * 16);
      }
    }

    if (queryInfo.preferredFormats.length > 0 && queryInfo.preferredFormats.includes(format)) {
      score += 14;
    }

    score += toNumber(media?.meanScore) / 100;
    score += toNumber(media?.popularity) / 100000;

    if (tier < bestTier || (tier === bestTier && score > bestScore)) {
      bestTier = tier;
      bestScore = score;
    }
  }

  return { tier: bestTier, score: bestScore, exact };
}

export function mergeAndRankMedia(queryInfo, primary = [], fallback = []) {
  const merged = new Map();
  [...primary, ...fallback].forEach((media, index) => {
    if (!media) return;
    const key = mediaIdentity(media, index);
    if (!merged.has(key)) merged.set(key, media);
  });

  const candidates = Array.from(merged.values());
  const strict = candidates.map((media) => ({ media, ...rankOne(queryInfo, media, { allowFuzzy: false }) }));
  const strictRelevantCount = strict.filter((entry) => entry.tier <= 2).length;
  const shouldUseFuzzy = strictRelevantCount < 3;
  const scored = shouldUseFuzzy
    ? candidates.map((media) => ({ media, ...rankOne(queryInfo, media, { allowFuzzy: true }) }))
    : strict;

  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (b.score !== a.score) return b.score - a.score;
    const scoreDelta = toNumber(b.media?.meanScore) - toNumber(a.media?.meanScore);
    if (scoreDelta !== 0) return scoreDelta;
    return toNumber(b.media?.popularity) - toNumber(a.media?.popularity);
  });

  return {
    results: scored.map((entry) => entry.media),
    debug: {
      malIdDetected: queryInfo.malId,
      aliasExpansion: queryInfo.aliasExpansion,
      strictRelevantCount,
      fuzzyFallbackTriggered: shouldUseFuzzy,
      exactMatchCount: scored.filter((entry) => entry.exact).length,
      primaryCount: primary.length,
      fallbackCount: fallback.length,
      totalCandidates: scored.length,
    },
  };
}
