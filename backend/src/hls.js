import { fetchWithTimeout, getRequestOrigin, safeOrigin, sendBinary, sendJson, sendText } from './http.js';

const userAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function buildProxyUrl(apiBase, targetUrl, referer) {
  return `${apiBase}/api/hls?url=${encodeURIComponent(targetUrl)}&ref=${encodeURIComponent(referer)}`;
}

export async function handleHlsProxy({ req, res, url }) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, OPTIONS' });
  }

  const targetUrl = url.searchParams.get('url');
  const referer = url.searchParams.get('ref') || 'https://kwik.si/';

  if (!targetUrl) {
    return sendText(res, 400, 'Missing url param');
  }

  const apiBase = getRequestOrigin(req);
  const refererOrigin = safeOrigin(referer, 'https://kwik.si/');
  const isPlaylist = /(\.m3u8|playlist|master)/i.test(targetUrl);

  try {
    const response = await fetchWithTimeout(
      targetUrl,
      {
        headers: {
          'User-Agent': userAgent,
          Referer: referer,
          Origin: refererOrigin.slice(0, -1),
        },
      },
      isPlaylist ? 15000 : 30000,
    );

    if (!response.ok) {
      throw new Error(`Upstream returned ${response.status}`);
    }

    if (isPlaylist) {
      const text = await response.text();
      const baseUrl = new URL(targetUrl);

      const rewritten = text
        .split('\n')
        .map((line) => {
          const trimmed = line.trim();

          if (!trimmed) return line;

          if (trimmed.startsWith('#')) {
            if (!trimmed.includes('URI=')) return line;

            return line.replace(/URI="([^"]+)"/g, (_, uri) => {
              const absoluteUri = uri.startsWith('http') ? uri : new URL(uri, baseUrl).href;
              return `URI="${buildProxyUrl(apiBase, absoluteUri, referer)}"`;
            });
          }

          const absoluteUrl = trimmed.startsWith('http') ? trimmed : new URL(trimmed, baseUrl).href;
          return buildProxyUrl(apiBase, absoluteUrl, referer);
        })
        .join('\n');

      return sendText(res, 200, rewritten, {
        'Content-Type': response.headers.get('content-type') || 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-store',
      });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return sendBinary(res, 200, buffer, {
      'Content-Type': response.headers.get('content-type') || 'video/mp2t',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
  } catch (error) {
    console.error(`[hls] Error fetching ${targetUrl}:`, error);
    return sendJson(res, 502, { error: error.message });
  }
}
