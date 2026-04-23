const RAW_API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  (process.env.NODE_ENV === 'development' ? 'http://localhost:3001' : '');

function normalizeBase(base) {
  return base.replace(/\/+$/, '');
}

function isLocalHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function getResolvedApiBase() {
  const base = normalizeBase(RAW_API_BASE);
  if (!base) return '';
  if (typeof window === 'undefined') return base;

  try {
    const apiUrl = new URL(base);
    const pageUrl = new URL(window.location.href);

    // When the frontend is opened from another device on the LAN, a hardcoded
    // localhost API base points back to the phone itself. Reuse the current
    // page hostname and keep the API port so mobile testing works.
    if (isLocalHostname(apiUrl.hostname) && !isLocalHostname(pageUrl.hostname)) {
      apiUrl.hostname = pageUrl.hostname;
      return apiUrl.toString().replace(/\/+$/, '');
    }

    return base;
  } catch {
    return base;
  }
}

export function apiUrl(path) {
  if (!path) return path;
  if (/^https?:\/\//i.test(path)) return path;

  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const base = getResolvedApiBase();
  return base ? `${base}${cleanPath}` : cleanPath;
}
