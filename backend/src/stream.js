import { getRequestOrigin, safeOrigin, sendJson } from './http.js';
import { fetchWithTimeout } from './http.js';

const anitakuBase = 'https://anitaku.to';
const userAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u00B4`]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, '-')
    .replace(/[[\]{}()]/g, ' ')
    .replace(/[|/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function asciiWords(value) {
  return normalizeSearchText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripSeasonPart(value) {
  return normalizeSearchText(value)
    .replace(/\bseason\s*\d+\b/gi, '')
    .replace(/\b\d+(st|nd|rd|th)\s+season\b/gi, '')
    .replace(/\bpart\s*\d+\b/gi, '')
    .replace(/\bcour\s*\d+\b/gi, '')
    .replace(/\b(?:ii|iii|iv|v|vi|vii|viii|ix|x)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalizeFormat(value) {
  const upper = String(value || '').trim().toUpperCase();
  if (!upper) return null;
  if (upper === 'TV' || upper === 'TV_SHORT') return 'tv';
  if (upper === 'MOVIE') return 'movie';
  if (upper === 'SPECIAL') return 'special';
  if (upper === 'OVA') return 'ova';
  if (upper === 'ONA') return 'ona';
  return upper.toLowerCase();
}

function parseSeasonMarker(value) {
  const text = asciiWords(value);
  if (!text) return null;

  const explicitSeason =
    text.match(/\bseason\s+(\d+)\b/) ||
    text.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/) ||
    text.match(/\bpart\s+(\d+)\b/) ||
    text.match(/\bcour\s+(\d+)\b/);

  if (explicitSeason) return Number.parseInt(explicitSeason[1], 10);

  const romanMatch = text.match(/\b(ii|iii|iv|v|vi|vii|viii|ix|x)\b/);
  if (romanMatch) {
    const map = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
    return map[romanMatch[1]];
  }

  if (/\bmovie\b/.test(text)) return 0;
  return null;
}

function tokenSet(value) {
  return new Set(asciiWords(value).split(' ').filter((token) => token.length > 1));
}

function tokenOverlapScore(left, right) {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (!leftTokens.size || !rightTokens.size) return 0;

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function scoreTitlePair(targetTitle, candidateTitle) {
  if (!targetTitle || !candidateTitle) return 0;

  const normalizedTarget = asciiWords(targetTitle);
  const normalizedCandidate = asciiWords(candidateTitle);
  if (!normalizedTarget || !normalizedCandidate) return 0;

  const targetBase = asciiWords(stripSeasonPart(targetTitle));
  const candidateBase = asciiWords(stripSeasonPart(candidateTitle));

  let score = 0;

  if (normalizedTarget === normalizedCandidate) score += 140;
  if (targetBase && candidateBase && targetBase === candidateBase) score += 110;

  if (normalizedCandidate.includes(normalizedTarget) || normalizedTarget.includes(normalizedCandidate)) {
    score += 45;
  }

  score += Math.round(tokenOverlapScore(targetTitle, candidateTitle) * 80);

  const targetSeason = parseSeasonMarker(targetTitle);
  const candidateSeason = parseSeasonMarker(candidateTitle);
  if (
    targetSeason != null &&
    candidateSeason != null &&
    targetSeason !== candidateSeason
  ) {
    score -= 55;
  }

  if (targetSeason == null && candidateSeason != null && candidateSeason > 1) {
    score -= 160;
  }

  return score;
}

function scoreTitleAgainstCandidates(targetTitles, candidateTitles) {
  let best = 0;
  for (const targetTitle of targetTitles) {
    for (const candidateTitle of candidateTitles) {
      best = Math.max(best, scoreTitlePair(targetTitle, candidateTitle));
    }
  }
  return best;
}

async function fetchText(url, headers = {}, timeoutMs = 15000) {
  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        'User-Agent': userAgent,
        Referer: anitakuBase,
        ...headers,
      },
    },
    timeoutMs,
  );

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  return response.text();
}

function buildSearchTerms(titles) {
  const variants = [];

  for (const title of titles) {
    const normalized = normalizeSearchText(title);
    const stripped = stripSeasonPart(normalized);
    const ascii = asciiWords(normalized);
    const asciiStripped = asciiWords(stripped);
    const yearMatch = normalized.match(/\b(19\d{2}|20\d{2})\b/);
    const withoutYear = yearMatch ? normalizeSearchText(normalized.replace(yearMatch[1], ' ')) : normalized;
    const mainTitle = withoutYear.split(':')[0].trim() || withoutYear;
    const baseWords = (asciiStripped || ascii || asciiWords(mainTitle)).split(' ').filter(Boolean);

    variants.push(
      normalized,
      normalized.replace(/'/g, ''),
      stripped,
      stripped.replace(/'/g, ''),
      ascii,
      asciiStripped,
      withoutYear,
      mainTitle,
      asciiWords(mainTitle),
      mainTitle.split(' ').slice(0, 3).join(' '),
      mainTitle.split(' ').slice(0, 2).join(' '),
      baseWords.slice(0, 4).join(' '),
      baseWords.slice(0, 3).join(' '),
      baseWords.slice(0, 2).join(' '),
    );

    if (yearMatch) {
      variants.push(`${mainTitle} ${yearMatch[1]}`);
    }
  }

  return uniqueStrings(variants.map(normalizeSearchText).filter((term) => term.length > 2));
}

function parseSearchResults(html) {
  const results = [];
  const itemRegex = /<li>\s*<div class="img">[\s\S]*?<a href="\/category\/([^"]+)" title="([^"]+)">[\s\S]*?<p class="released">\s*Released:\s*([^<]*)<\/p>[\s\S]*?<\/li>/gi;

  for (const match of html.matchAll(itemRegex)) {
    results.push({
      slug: decodeHtmlEntities(match[1]),
      title: decodeHtmlEntities(stripTags(match[2])),
      released: Number.parseInt(stripTags(match[3]), 10) || null,
    });
  }

  return results;
}

function parseCategoryMetadata(html, slug) {
  const title = decodeHtmlEntities(stripTags(html.match(/<h1>\s*([\s\S]*?)\s*<\/h1>/i)?.[1] || ''));
  const otherNamesRaw = decodeHtmlEntities(
    stripTags(html.match(/<p class="type other-name">[\s\S]*?<span>[\s\S]*?<\/span>\s*([\s\S]*?)<\/p>/i)?.[1] || ''),
  );
  const otherNames = uniqueStrings(otherNamesRaw.split(/[;,/]| {2,}/).map((value) => value.trim()));
  const type = normalizeFormat(
    decodeHtmlEntities(stripTags(html.match(/<span>\s*Type:\s*<\/span>\s*(?:<a[^>]*>)?([^<\n]+)/i)?.[1] || '')),
  );
  const episodes = Number.parseInt(
    stripTags(html.match(/<span>\s*Episodes:\s*<\/span>\s*([^<]+)/i)?.[1] || ''),
    10,
  ) || null;
  const released = Number.parseInt(
    stripTags(html.match(/<span>\s*Released:\s*<\/span>\s*([^<]+)/i)?.[1] || ''),
    10,
  ) || null;
  const duration = Number.parseInt(
    stripTags(html.match(/<span>\s*Duration:\s*<\/span>\s*([^<]+)/i)?.[1] || ''),
    10,
  ) || null;

  const episodeMap = new Map();
  for (const match of html.matchAll(/<a href="([^"]+)"[^>]*data-num="([^"]+)"[^>]*>/gi)) {
    const href = decodeHtmlEntities(match[1]);
    const episodeNumber = Number.parseFloat(match[2]);
    if (!Number.isFinite(episodeNumber)) continue;
    episodeMap.set(episodeNumber, href);
  }

  return {
    slug,
    title,
    otherNames,
    candidateTitles: uniqueStrings([title, ...otherNames]),
    type,
    episodes,
    released,
    duration,
    episodeMap,
  };
}

function scoreCandidateMetadata(candidate, request) {
  const targetTitles = request.titles;
  const candidateTitles = candidate.candidateTitles;
  let score = scoreTitleAgainstCandidates(targetTitles, candidateTitles);
  const requestHasExplicitSeason = targetTitles.some((title) => parseSeasonMarker(title) != null);
  const candidateSeason = parseSeasonMarker(candidate.title);

  if (request.year && candidate.released) {
    const diff = Math.abs(request.year - candidate.released);
    if (diff === 0) score += 45;
    else if (diff === 1) score += 10;
    else score -= Math.min(45, diff * 10);
  }

  if (request.format && candidate.type) {
    score += request.format === candidate.type ? 28 : -24;
  }

  if (request.totalEpisodes && candidate.episodes) {
    const diff = Math.abs(request.totalEpisodes - candidate.episodes);
    if (diff === 0) score += 30;
    else if (diff <= 2) score += 8;
    else score -= Math.min(35, diff * 5);
  }

  if (request.duration && candidate.duration) {
    const diff = Math.abs(request.duration - candidate.duration);
    if (diff <= 1) score += 18;
    else if (diff <= 3) score += 10;
    else if (diff <= 6) score += 4;
    else score -= Math.min(14, diff * 2);
  }

  const primarySeason = parseSeasonMarker(request.primaryTitle);
  if (
    primarySeason != null &&
    candidateSeason != null &&
    primarySeason !== candidateSeason
  ) {
    score -= 60;
  }

  if (!requestHasExplicitSeason && candidateSeason != null && candidateSeason > 1) {
    score -= 220;
  }

  return score;
}

async function findBestSeriesCandidate(request) {
  const bySlug = new Map();
  const searchTerms = buildSearchTerms(request.titles);

  for (const term of searchTerms) {
    try {
      const html = await fetchText(`${anitakuBase}/search.html?keyword=${encodeURIComponent(term)}`);
      const results = parseSearchResults(html);
      for (const result of results) {
        const score =
          scoreTitleAgainstCandidates(request.titles, [result.title]) +
          (request.year && result.released
            ? request.year === result.released
              ? 15
              : -Math.min(12, Math.abs(request.year - result.released) * 4)
            : 0);

        const existing = bySlug.get(result.slug);
        if (!existing || score > existing.searchScore) {
          bySlug.set(result.slug, {
            ...result,
            searchScore: score,
          });
        }
      }
    } catch (error) {
      console.warn(`[stream] Search term "${term}" failed:`, error.message);
    }
  }

  const shortlist = [...bySlug.values()]
    .sort((left, right) => right.searchScore - left.searchScore)
    .slice(0, 6);

  let best = null;

  for (const candidate of shortlist) {
    try {
      const html = await fetchText(`${anitakuBase}/category/${candidate.slug}`);
      const metadata = parseCategoryMetadata(html, candidate.slug);
      const score = candidate.searchScore + scoreCandidateMetadata(metadata, request);
      const episodeHref = metadata.episodeMap.get(request.episodeNumber) || null;
      const finalScore = score + (episodeHref ? 40 : -120);

      if (!best || finalScore > best.score) {
        best = {
          ...metadata,
          episodeHref,
          score: finalScore,
        };
      }
    } catch (error) {
      console.warn(`[stream] Candidate "${candidate.slug}" failed:`, error.message);
    }
  }

  return best;
}

function buildFallbackEpisodeUrl(slug, episodeNumber) {
  return `/${slug}-episode-${episodeNumber}`;
}

async function getVideoServers(episodeSlug) {
  const html = await fetchText(`${anitakuBase}${episodeSlug}`);
  return [...html.matchAll(/data-video\s*=\s*["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .filter(Boolean);
}

async function extractM3u8FromUrl(videoUrl) {
  try {
    const html = await fetchText(videoUrl, { Referer: videoUrl });
    const directMatch = html.match(/https:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
    if (directMatch?.[0]) return directMatch[0];

    const srcMatch = html.match(/(?:src|data-src)\s*=\s*"([^"]*\.m3u8[^"]*)"/i);
    if (srcMatch?.[1]) return srcMatch[1];

    const playerMatch = html.match(/player\.src\([^)]*src\s*:\s*"([^"]+)"/i);
    if (playerMatch?.[1]) return playerMatch[1];
  } catch (error) {
    console.warn('[stream] VibePlayer extraction failed:', error.message);
  }

  return null;
}

async function getStreamsbDirect(streamUrl) {
  try {
    const html = await fetchText(
      streamUrl,
      {
        Referer: streamUrl,
        Origin: safeOrigin(streamUrl, 'https://streamsb.net/').slice(0, -1),
      },
      15000,
    );

    const m3u8Match = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i);
    if (m3u8Match?.[0]) return m3u8Match[0];

    const videoSrcMatch = html.match(/source\s+src\s*=\s*["']([^"']+)["']/i);
    return videoSrcMatch?.[1] || null;
  } catch (error) {
    console.warn('[stream] StreamSB extraction failed:', error.message);
    return null;
  }
}

async function getDoodStream(doodUrl) {
  try {
    const html = await fetchText(doodUrl, { Referer: doodUrl });
    const match = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i);
    return match?.[0] || null;
  } catch (error) {
    console.warn('[stream] Dood extraction failed:', error.message);
    return null;
  }
}

export async function handleStream({ req, res, url }) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, OPTIONS' });
  }

  const title = url.searchParams.get('title')?.trim();
  const episode = Number.parseFloat(url.searchParams.get('episode')?.trim() || '1');
  const altTitles = (url.searchParams.get('altTitles') || '')
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
  const year = Number.parseInt(url.searchParams.get('year') || '', 10) || null;
  const format = normalizeFormat(url.searchParams.get('format'));
  const totalEpisodes = Number.parseInt(url.searchParams.get('totalEpisodes') || '', 10) || null;
  const duration = Number.parseInt(url.searchParams.get('duration') || '', 10) || null;

  if (!title) {
    return sendJson(res, 400, { error: 'Missing param: title' });
  }

  if (!Number.isFinite(episode) || episode <= 0) {
    return sendJson(res, 400, { error: 'Invalid episode' });
  }

  try {
    const titles = uniqueStrings([title, ...altTitles]);
    const request = {
      titles,
      primaryTitle: title,
      episodeNumber: episode,
      year,
      format,
      totalEpisodes,
      duration,
    };

    const series = await findBestSeriesCandidate(request);
    if (!series) {
      throw new Error(`No matching series found for "${title}"`);
    }

    const episodeSlug = series.episodeHref || buildFallbackEpisodeUrl(series.slug, episode);
    const servers = await getVideoServers(episodeSlug);
    if (!servers.length) {
      throw new Error('No video servers found');
    }

    const serverPriority = ['streamsb', 'streamshide', 'vibeplayer', 'dood', 'mixdrop'];
    const sortedServers = [...servers].sort((left, right) => {
      const leftIndex = serverPriority.findIndex((value) => left.includes(value));
      const rightIndex = serverPriority.findIndex((value) => right.includes(value));
      return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
    });

    let streamUrl = null;
    let referer = 'https://vibeplayer.site/';
    let subtitleUrl = null;
    let subtitleLang = 'English';

    for (const server of sortedServers) {
      if (server.includes('streamsb') || server.includes('streamshide')) {
        streamUrl = await getStreamsbDirect(server);
        referer = safeOrigin(server, referer);
      } else if (server.includes('dood')) {
        streamUrl = await getDoodStream(server);
        referer = safeOrigin(server, referer);
      } else if (server.includes('vibeplayer.site') || server.includes('otakuhg.site') || server.includes('otakuvid.online')) {
        streamUrl = await extractM3u8FromUrl(server);
        referer = safeOrigin(server, referer);
      } else if (server.includes('.m3u8')) {
        streamUrl = server;
        referer = safeOrigin(server, referer);
      }

      if (streamUrl) {
        try {
          const sUrl = new URL(server);
          subtitleUrl = sUrl.searchParams.get('sub') || sUrl.searchParams.get('caption_1');
          if (sUrl.searchParams.get('sub_1')) {
            subtitleLang = sUrl.searchParams.get('sub_1');
          }
        } catch (e) {}
        break;
      }
    }

    if (!streamUrl) {
      throw new Error('Could not extract video URL');
    }

    const backendOrigin = getRequestOrigin(req);
    const proxiedStreamUrl =
      `${backendOrigin}/api/hls?url=${encodeURIComponent(streamUrl)}` +
      `&ref=${encodeURIComponent(referer)}`;

    return sendJson(res, 200, {
      streamUrl: proxiedStreamUrl,
      subtitles: subtitleUrl ? [{ url: subtitleUrl, name: subtitleLang, type: 'vtt' }] : [],
      resolved: {
        slug: series.slug,
        title: series.title,
        episode: episode,
      },
    });
  } catch (error) {
    console.error('[stream] Error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}
