import { fetchWithTimeout, getRequestOrigin, safeOrigin, sendJson } from './http.js';

const aniwaveReferer = 'https://animewave.to/';
const kwikReferer = 'https://kwik.cx/';
const userAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchText(url, headers = {}, timeoutMs = 15000) {
  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        'User-Agent': userAgent,
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

async function fetchJson(url, headers = {}, timeoutMs = 15000) {
  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        'User-Agent': userAgent,
        Accept: 'application/json',
        ...headers,
      },
    },
    timeoutMs,
  );

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  return response.json();
}

// ── Mapper: maps MAL ID + episode to quality-keyed link IDs ──

async function fetchMapperData(malId, episode) {
  const ts = Math.floor(Date.now() / 1000);
  const data = await fetchJson(
    `https://mapper.mewcdn.online/api/mal/${malId}/${episode}/${ts}`,
    { Referer: aniwaveReferer },
  );
  return data;
}

// ── Server: resolves a link ID to a Kwik embed URL + skip data ──

async function fetchKwikServer(linkId) {
  const data = await fetchJson(
    `https://animewave.to/ajax/server?get=${linkId}&autostart=true`,
    {
      Referer: aniwaveReferer,
      'X-Requested-With': 'XMLHttpRequest',
    },
  );
  return data?.result || null;
}

// ── Kwik: unpack packed JS to extract m3u8 URL and cookies ──

async function unpackKwikStream(kwikUrl) {
  const res = await fetchWithTimeout(
    kwikUrl,
    {
      headers: {
        'User-Agent': userAgent,
        Referer: aniwaveReferer,
      },
    },
    15000,
  );

  if (!res.ok) return null;

  const setCookies = res.headers.getSetCookie?.() ?? [];
  const cookies = setCookies.map((c) => c.split(';')[0]).join('; ');
  const html = await res.text();

  // Find eval(function(p,a,c,k,e,d) blocks and unpack them
  const evalRegex = /eval\(function\(p,a,c,k,e,d\)/g;
  let match;
  while ((match = evalRegex.exec(html)) !== null) {
    let depth = 0;
    let i = match.index + 4; // skip past "eval"
    for (; i < html.length; i++) {
      if (html[i] === '(') depth++;
      else if (html[i] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }

    try {
      // eslint-disable-next-line no-eval
      const unpacked = eval(html.substring(match.index + 4, i + 1));
      const srcMatch = String(unpacked).match(/const source='([^']+\.m3u8[^']*)'/);
      if (srcMatch) {
        return { m3u8: srcMatch[1], cookies };
      }
    } catch {
      continue;
    }
  }

  return null;
}

// ── Quality key mapping ──

const QUALITY_MAP = {
  'Kiwi-Stream-1080p': '1080p',
  'Kiwi-Stream-720p': '720p',
  'Kiwi-Stream-480p': '480p',
  'Kiwi-Stream-360p': '360p',
};

// ── API handler ──

export async function handleAniwaveStream({ req, res, url }) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, OPTIONS' });
  }

  const malId = url.searchParams.get('malId')?.trim();
  const episode = url.searchParams.get('episode')?.trim() || '1';
  const lang = url.searchParams.get('lang')?.trim() || 'sub';

  if (!malId) {
    return sendJson(res, 400, { error: 'Missing param: malId' });
  }

  try {
    const mapper = await fetchMapperData(malId, episode);

    const streams = [];
    let intro = { start: 0, end: 0 };
    let outro = { start: 0, end: 0 };

    for (const [qKey, qLabel] of Object.entries(QUALITY_MAP)) {
      const linkId = mapper[qKey]?.[lang]?.url ?? null;
      if (!linkId) continue;

      try {
        const server = await fetchKwikServer(linkId);
        const kwikUrl = server?.url;
        if (!kwikUrl) continue;

        const kwikData = await unpackKwikStream(kwikUrl);
        if (!kwikData) continue;

        // Capture skip data from first successful server
        if (intro.end === 0 && server?.skip_data?.intro) {
          intro = { start: server.skip_data.intro[0] || 0, end: server.skip_data.intro[1] || 0 };
          outro = { start: server.skip_data.outro?.[0] || 0, end: server.skip_data.outro?.[1] || 0 };
        }

        const backendOrigin = getRequestOrigin(req);
        let proxiedUrl = `${backendOrigin}/api/hls?url=${encodeURIComponent(kwikData.m3u8)}&ref=${encodeURIComponent(kwikReferer)}`;
        if (kwikData.cookies) {
          proxiedUrl += `&cookies=${encodeURIComponent(kwikData.cookies)}`;
        }

        streams.push({
          quality: qLabel,
          url: proxiedUrl,
          rawUrl: kwikData.m3u8,
          referer: kwikReferer,
          cookies: kwikData.cookies || '',
        });
      } catch (error) {
        console.warn(`[aniwave] Quality ${qLabel} failed:`, error.message);
      }
    }

    if (!streams.length) {
      return sendJson(res, 404, { error: 'No streams found on AniWave' });
    }

    return sendJson(res, 200, {
      streams,
      intro,
      outro,
    });
  } catch (error) {
    console.error('[aniwave] Error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}
