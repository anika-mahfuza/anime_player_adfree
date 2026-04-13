import axios from 'axios';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Common CORS headers added to every proxied response
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get('url');
  const referer   = searchParams.get('ref') || 'https://kwik.si/';

  if (!targetUrl) {
    return new Response('Missing url param', { status: 400, headers: CORS });
  }

  const isPlaylist =
    targetUrl.includes('.m3u8') ||
    targetUrl.includes('playlist') ||
    targetUrl.includes('master');

  try {
    if (isPlaylist) {
      // ── Text-mode: fetch and rewrite the m3u8 playlist ──────────────────
      const { data: text, headers: resHeaders } = await axios.get(targetUrl, {
        responseType: 'text',
        headers: {
          'User-Agent': UA,
          Referer: referer,
          Origin: new URL(referer).origin,
        },
        timeout: 15_000,
      });

      // Base URL for resolving relative paths in the playlist
      const base = new URL(targetUrl);
      const baseDir = targetUrl.slice(0, targetUrl.lastIndexOf('/') + 1);

      // Rewrite every non-comment line so it routes through this proxy
      const rewritten = text
        .split('\n')
        .map((line) => {
          const trimmed = line.trim();

          // Skip blank lines and comment/directive lines (except URI= attributes)
          if (!trimmed || (trimmed.startsWith('#') && !trimmed.includes('URI='))) {
            // Handle URI="..." inside EXT-X-KEY tags (encryption key URLs)
            if (trimmed.includes('URI="')) {
              return trimmed.replace(/URI="([^"]+)"/g, (_, uri) => {
                const abs = uri.startsWith('http') ? uri : new URL(uri, base).href;
                return `URI="/api/hls?url=${encodeURIComponent(abs)}&ref=${encodeURIComponent(referer)}"`;
              });
            }
            return line;
          }

          // Resolve relative URLs → absolute → through our proxy
          const abs = trimmed.startsWith('http') ? trimmed : new URL(trimmed, base).href;
          return `/api/hls?url=${encodeURIComponent(abs)}&ref=${encodeURIComponent(referer)}`;
        })
        .join('\n');

      return new Response(rewritten, {
        status: 200,
        headers: {
          ...CORS,
          'Content-Type': resHeaders['content-type'] || 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-store',
        },
      });
    } else {
      // ── Binary-mode: proxy TS segments / encryption keys ────────────────
      const { data, headers: resHeaders } = await axios.get(targetUrl, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': UA,
          Referer: referer,
          Origin: new URL(referer).origin,
        },
        timeout: 30_000,
      });

      return new Response(Buffer.from(data), {
        status: 200,
        headers: {
          ...CORS,
          'Content-Type': resHeaders['content-type'] || 'video/mp2t',
          // Allow browser to cache segments — they never change
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }
  } catch (err) {
    console.error(`[hls-proxy] Error fetching ${targetUrl}:`, err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }
}
