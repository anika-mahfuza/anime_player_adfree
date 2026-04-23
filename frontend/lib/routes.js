export function animeHref(id) {
  if (!id) return '/';
  return `/anime?id=${encodeURIComponent(id)}`;
}

export function watchHref(id) {
  if (!id) return '/';
  return `/watch?id=${encodeURIComponent(id)}`;
}
