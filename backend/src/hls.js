import { applyCors, fetchWithTimeout, getRequestOrigin, sendJson, sendText } from './http.js';

const userAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const exposedHeaders = 'Content-Length, Content-Range, Accept-Ranges';

function buildProxyUrl(apiBase, targetUrl, referer, cookies, cacheToken) {
  let u = `${apiBase}/api/hls?url=${encodeURIComponent(targetUrl)}&ref=${encodeURIComponent(referer)}`;
  if (cookies) u += `&cookies=${encodeURIComponent(cookies)}`;
  if (cacheToken) u += `&cb=${encodeURIComponent(cacheToken)}`;
  return u;
}

function getTargetPath(targetUrl) {
  try {
    return new URL(targetUrl).pathname.toLowerCase();
  } catch {
    return '';
  }
}

function getAssetContentType(targetUrl, contentType) {
  const path = getTargetPath(targetUrl);
  if (path.endsWith('.key')) return 'application/octet-stream';
  return contentType || 'application/octet-stream';
}

function setHeaderIfPresent(res, name, value) {
  if (value) res.setHeader(name, value);
}

export async function handleHlsProxy({ req, res, url }) {
  if (req.method === 'OPTIONS') {
    applyCors(res);
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, OPTIONS' });
  }

  const targetUrl = url.searchParams.get('url');
  const referer = url.searchParams.get('ref') || 'https://kwik.cx/';
  const cookies = url.searchParams.get('cookies');

  if (!targetUrl) {
    return sendText(res, 400, 'Missing url param');
  }

  const apiBase = getRequestOrigin(req);
  const looksLikePlaylist = /(\.m3u8|playlist|master)/i.test(targetUrl);

  try {
    console.log(`[hls] Fetching: ${targetUrl}`);
    console.log(`[hls] Referer: ${referer}`);
    
    // Try with standard headers first
    let headers = {
      'User-Agent': userAgent,
      Referer: referer,
      Origin: 'https://kwik.cx',
      ...(req.headers.range ? { Range: req.headers.range } : {}),
      ...(cookies ? { Cookie: cookies } : {}),
    };

    let response = await fetchWithTimeout(targetUrl, { headers }, looksLikePlaylist ? 15000 : 30000);

    // If first attempt fails, try with minimal headers
    if (!response.ok && response.status === 403) {
      console.log(`[hls] First attempt failed, trying with minimal headers`);
      headers = {
        'User-Agent': userAgent,
        ...(cookies ? { Cookie: cookies } : {}),
      };
      response = await fetchWithTimeout(targetUrl, { headers }, looksLikePlaylist ? 15000 : 30000);
    }

    console.log(`[hls] Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[hls] Upstream error body:`, errorText);
      throw new Error(`Upstream returned ${response.status}: ${errorText.slice(0, 200)}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const isPlaylist = looksLikePlaylist || contentType.includes('mpegurl');

    if (isPlaylist) {
      const text = await response.text();
      const baseUrl = new URL(targetUrl);
      const cacheToken = Date.now().toString(36);

      // Step 1: Resolve relative URLs to absolute
      // Match lines that are NOT comments and NOT empty — these are segment/variant URLs
      const withAbsolute = text.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        if (trimmed.startsWith('http')) return line;
        try {
          return new URL(trimmed, baseUrl).href;
        } catch {
          return line;
        }
      }).join('\n');

      // Step 2: Rewrite ALL absolute URLs to proxy URLs (same approach as working test server)
      const rewritten = withAbsolute.replace(/https?:\/\/[^\s"'#]+/g, u => {
        const proxyUrl = buildProxyUrl(apiBase, u, referer, cookies, cacheToken);
        console.log(`[hls] Rewriting URL: ${u} -> ${proxyUrl}`);
        return proxyUrl;
      });

      console.log(`[hls] Returning playlist with ${rewritten.split('\n').filter(line => line.trim() && !line.trim().startsWith('#')).length} stream URLs`);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache');
      return res.end(rewritten);
    }

    // Non-playlist: stream segments/keys directly
    const ct = response.headers.get('content-type') || '';

    applyCors(res, { 'Access-Control-Expose-Headers': exposedHeaders });
    res.statusCode = response.status;
    res.setHeader('Content-Type', getAssetContentType(targetUrl, ct));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Accept-Ranges', response.headers.get('accept-ranges') || 'bytes');
    setHeaderIfPresent(res, 'Content-Length', response.headers.get('content-length'));
    setHeaderIfPresent(res, 'Content-Range', response.headers.get('content-range'));
    setHeaderIfPresent(res, 'ETag', response.headers.get('etag'));
    setHeaderIfPresent(res, 'Last-Modified', response.headers.get('last-modified'));

    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } catch (e) {
      reader.cancel();
      throw e;
    }
  } catch (error) {
    console.error(`[hls] Error fetching ${targetUrl}:`, error);
    return sendJson(res, 502, { error: error.message });
  }
}
