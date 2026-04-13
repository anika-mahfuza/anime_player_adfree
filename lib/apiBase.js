const RAW_API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || '';

function normalizeBase(base) {
  return base.replace(/\/+$/, '');
}

export function apiUrl(path) {
  if (!path) return path;
  if (/^https?:\/\//i.test(path)) return path;

  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const base = normalizeBase(RAW_API_BASE);
  return base ? `${base}${cleanPath}` : cleanPath;
}
