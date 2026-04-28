import https from 'https';
import zlib from 'zlib';

function fetchUrl(url, referer, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Origin: 'https://megaplay.buzz',
        Referer: referer,
        ...extraHeaders,          // <-- important
      },
    };
    https.get(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        let buffer = Buffer.concat(chunks);
        if (res.headers['content-encoding']?.includes('gzip')) {
          zlib.gunzip(buffer, (err, decoded) => {
            if (err) reject(err);
            else resolve(decoded);
          });
        } else {
          resolve(buffer);
        }
      });
    }).on('error', reject);
  });
}

export async function getMegaplayTimestamps(malId, episode, language = 'sub') {
  const streamUrl = `https://megaplay.buzz/stream/mal/${malId}/${episode}/${language}`;
  const page = (await fetchUrl(streamUrl, 'https://megaplay.buzz/api')).toString();
  const dataIdMatch = page.match(/data-id="(\d+)"/);
  if (!dataIdMatch) throw new Error('Could not find data-id in page');

  // ★ This is the critical missing header
  const sourcesUrl = `https://megaplay.buzz/stream/getSources?id=${dataIdMatch[1]}`;
  const sourcesJson = (await fetchUrl(
    sourcesUrl,
    'https://megaplay.buzz/api',
    { 'X-Requested-With': 'XMLHttpRequest' }
  )).toString();
  const sources = JSON.parse(sourcesJson);

  const intro = sources.intro || {};
  const outro = sources.outro || {};
  return {
    introStart: intro.start ?? null,
    introEnd:   intro.end   ?? null,
    outroStart: outro.start ?? null,
    outroEnd:   outro.end   ?? null,
  };
}

export const toMMSS = (seconds) => {
  if (seconds == null) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};