// server.mjs — AniWave/Kwik HLS scraper
import http from 'http';
import https from 'https';

const PORT = 3001;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA };

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}
function err(res, msg, status = 500) {
  json(res, { error: msg }, status);
}
function proxyUrl(url, referer, cookies) {
  let u = `http://localhost:${PORT}/proxy?url=${encodeURIComponent(url)}`;
  if (referer) u += `&referer=${encodeURIComponent(referer)}`;
  if (cookies) u += `&cookies=${encodeURIComponent(cookies)}`;
  return u;
}

async function fetchJson(url, extraHeaders = {}) {
  const res = await fetch(url, { headers: { ...HEADERS, ...extraHeaders } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getKwikData(kwikUrl) {
  const res = await fetch(kwikUrl, { headers: { ...HEADERS, Referer: 'https://animewave.to/' } });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const cookies = setCookies.map(c => c.split(';')[0]).join('; ');
  const html = await res.text();

  const evalRegex = /eval\(function\(p,a,c,k,e,d\)/g;
  let match;
  while ((match = evalRegex.exec(html)) !== null) {
    let depth = 0, i = match.index + 4;
    for (; i < html.length; i++) {
      if (html[i] === '(') depth++;
      else if (html[i] === ')') { depth--; if (depth === 0) break; }
    }
    try {
      const unpacked = eval(html.substring(match.index + 4, i + 1));
      const srcMatch = unpacked.match(/const source='([^']+\.m3u8[^']*)'/);
      if (srcMatch) return { m3u8: srcMatch[1], cookies };
    } catch { continue; }
  }
  return null;
}

// ── Routes ───────────────────────────────────────────────────

async function handleSearch(params, res) {
  const q = params.get('q');
  if (!q) return err(res, 'missing q', 400);
  try {
    const data = await fetchJson(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=10`);
    const results = (data.data || []).map(item => ({
      malId: item.mal_id,
      title: item.title,
      title_english: item.title_english,
      episodes: item.episodes,
      image: item.images?.jpg?.image_url,
      synopsis: item.synopsis,
    }));
    json(res, { results });
  } catch (e) { err(res, e.message); }
}

// NEW: AniZip episodes — updates fast, returns all eps at once
async function handleEpisodes(params, res) {
  const malId = params.get('malId');
  const page = parseInt(params.get('page') || '1', 10);
  if (!malId) return err(res, 'missing malId', 400);

  try {
    const data = await fetchJson(`https://api.ani.zip/mappings?mal_id=${malId}`);
    const epObj = data?.episodes || {};

    const allEps = Object.entries(epObj)
      .map(([num, info]) => {
        // Skip non-numeric keys (mal_id, synonyms, etc.) and null entries
        const n = parseInt(num, 10);
        if (isNaN(n) || !info || typeof info !== 'object') return null;

        // AniZip titles can be strings OR objects {en, jp, x-jat...}
        let title = '';
        if (typeof info.title === 'string') {
          title = info.title;
        } else if (info.title && typeof info.title === 'object') {
          title = info.title.en 
               || info.title.english 
               || info.title['x-jat'] 
               || info.title.romaji 
               || Object.values(info.title).find(t => t) 
               || '';
        }

        // Filter out ghost placeholders (future eps with zero data)
        const hasData = title.trim().length > 0 || info.image || info.overview;
        if (!hasData) return null;

        return {
          number: n,
          title: title,
          image: info.image || null,
        };
      })
      .filter(ep => ep !== null)
      .sort((a, b) => a.number - b.number);

    const perPage = 100;
    const total = allEps.length;
    const lastPage = Math.max(1, Math.ceil(total / perPage));
    const start = (page - 1) * perPage;
    const slice = allEps.slice(start, start + perPage);

    json(res, {
      data: slice,
      last_page: lastPage,
    });
  } catch (e) { err(res, e.message); }
}

async function handleStreams(params, res) {
  const malId = params.get('malId');
  const episode = params.get('episode') || '1';
  const lang = params.get('lang') || 'sub';
  if (!malId) return err(res, 'missing malId', 400);

  try {
    const ts = Math.floor(Date.now() / 1000);
    const mapper = await fetchJson(
      `https://mapper.mewcdn.online/api/mal/${malId}/${episode}/${ts}`,
      { Referer: 'https://animewave.to/' }
    );

    const qualityMap = {
      'Kiwi-Stream-1080p': '1080p',
      'Kiwi-Stream-720p': '720p',
      'Kiwi-Stream-480p': '480p',
      'Kiwi-Stream-360p': '360p',
    };

    const streams = [];
    let intro = [0, 0], outro = [0, 0];

    for (const [qKey, qLabel] of Object.entries(qualityMap)) {
      const linkId = mapper[qKey]?.[lang]?.url ?? null;
      if (!linkId) continue;

      const server = await fetchJson(
        `https://animewave.to/ajax/server?get=${linkId}&autostart=true`,
        { Referer: 'https://animewave.to/', 'X-Requested-With': 'XMLHttpRequest' }
      );

      const kwikUrl = server?.result?.url;
      if (!kwikUrl) continue;

      const kwikData = await getKwikData(kwikUrl);
      if (!kwikData) continue;

      if (intro[1] === 0 && server?.result?.skip_data?.intro) {
        intro = server.result.skip_data.intro;
        outro = server.result.skip_data.outro || [0, 0];
      }

      streams.push({
        quality: qLabel,
        url: proxyUrl(kwikData.m3u8, 'https://kwik.cx/', kwikData.cookies),
        rawUrl: kwikData.m3u8,
        referer: 'https://kwik.cx/',
        cookies: kwikData.cookies,
      });
    }

    if (!streams.length) return err(res, 'No streams found', 404);

    json(res, {
      streams,
      intro: { start: intro[0], end: intro[1] },
      outro: { start: outro[0], end: outro[1] },
    });
  } catch (e) { err(res, e.message); }
}

function handleProxy(params, res) {
  const target = params.get('url');
  if (!target?.startsWith('http')) { res.writeHead(400); res.end('bad url'); return; }

  const parsed = new URL(target);
  const reqModule = parsed.protocol === 'https:' ? https : http;

  const proxyHeaders = {
    referer: params.get('referer') || 'https://kwik.cx/',
    origin: 'https://kwik.cx',
    'user-agent': UA,
  };
  const cookies = params.get('cookies');
  if (cookies) proxyHeaders['Cookie'] = cookies;

  reqModule.get({
    hostname: parsed.hostname,
    path: parsed.pathname + parsed.search,
    headers: proxyHeaders
  }, upstream => {
    const ct = upstream.headers['content-type'] || '';
    const isM3u8 = target.includes('.m3u8') || ct.includes('mpegurl');
    if (isM3u8) {
      let body = '';
      upstream.setEncoding('utf8');
      upstream.on('data', d => body += d);
      upstream.on('end', () => {
        const rewritten = body.replace(/https?:\/\/[^\s"'#]+/g, u =>
          proxyUrl(u, proxyHeaders.referer, cookies)
        );
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Access-Control-Allow-Origin': '*' });
        res.end(rewritten);
      });
    } else {
      res.writeHead(upstream.statusCode, { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*' });
      upstream.pipe(res);
    }
  }).on('error', e => { res.writeHead(500); res.end(e.message); });
}

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const u = new URL(req.url, `http://localhost:${PORT}`);
  const path = u.pathname;
  const params = u.searchParams;

  try {
    if (path === '/api/search')    return await handleSearch(params, res);
    if (path === '/api/episodes')  return await handleEpisodes(params, res);
    if (path === '/api/streams')   return await handleStreams(params, res);
    if (path === '/proxy')         return handleProxy(params, res);
    res.writeHead(404); res.end('not found');
  } catch (e) {
    console.error(e);
    err(res, e.message);
  }
}).listen(PORT, () => console.log(`server: http://localhost:${PORT}`));