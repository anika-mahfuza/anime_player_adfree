export function watchHref(id) {
  if (!id) return '/';
  return `/watch?id=${encodeURIComponent(id)}`;
}
