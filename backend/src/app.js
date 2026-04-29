import { handleAniList } from './anilist.js';
import { handleAniZip } from './anizip.js';
import { handleHome } from './home.js';
import { handleHlsProxy } from './hls.js';
import { sendJson, sendNoContent } from './http.js';
import { handleJikan } from './jikan.js';
import { handleSkipTimes } from './skip-times.js';
import { handleStream } from './stream.js';
import { getRequestOrigin } from './http.js';

const routes = new Map([
  ['/api/anilist', handleAniList],
  ['/api/anizip', handleAniZip],
  ['/api/jikan', handleJikan],
  ['/api/home', handleHome],
  ['/api/hls', handleHlsProxy],
  ['/api/skip-times', handleSkipTimes],
  ['/api/stream', handleStream],
]);

export async function handleNodeRequest(req, res) {
  const url = new URL(req.url || '/', getRequestOrigin(req));

  if (url.pathname === '/health') {
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname.startsWith('/api/') && req.method === 'OPTIONS') {
    return sendNoContent(res);
  }

  const handler = routes.get(url.pathname);
  if (!handler) {
    return sendJson(res, 404, { error: 'Not found', path: url.pathname });
  }

  return handler({ req, res, url });
}
