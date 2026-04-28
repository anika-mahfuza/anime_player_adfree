export function animeHref(id) {
  if (!id) return '/';
  return `/anime?id=${encodeURIComponent(id)}`;
}

export function watchHref(id, options = {}) {
  if (!id) return '/';

  const params = new URLSearchParams({ id: String(id) });
  const episode = Number(options.episode);
  const time = Number(options.time);

  if (Number.isFinite(episode) && episode > 0) {
    params.set('ep', String(Math.floor(episode)));
  }

  if (Number.isFinite(time) && time > 0) {
    params.set('t', String(Math.floor(time)));
  }

  return `/watch?${params.toString()}`;
}
