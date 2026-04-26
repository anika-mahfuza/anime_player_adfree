import { sendJson } from './http.js';

export async function handleSkipTimes({ req, res, url }) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, OPTIONS' });
  }

  const malId = url.searchParams.get('malId');
  const episode = url.searchParams.get('episode');

  if (!malId || !episode) {
    return sendJson(res, 400, { error: 'Missing malId or episode' });
  }

  return sendJson(res, 200, {
    skipTimes: null,
    source: 'none',
    resolvedMalId: Number.parseInt(malId, 10) || null,
  });
}
