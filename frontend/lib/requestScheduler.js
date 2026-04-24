const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_MIN_GAP_MS = 180;
const DEFAULT_RETRY_COUNT = 3;
const DEFAULT_RETRY_BASE_MS = 1200;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const queue = [];
const inflight = new Map();
const cache = new Map();

let activeCount = 0;
let lastStartedAt = 0;
let processing = false;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readCache(key) {
  if (!key) return null;

  const cached = cache.get(key);
  if (!cached) return null;

  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return cached.value;
}

function parseRetryAfterMs(value) {
  if (!value) return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return numeric * 1000;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;

  const delay = timestamp - Date.now();
  return delay > 0 ? delay : 0;
}

function getRetryDelayMs(response, attempt) {
  const retryAfter = parseRetryAfterMs(response.headers.get('retry-after'));
  if (retryAfter != null) return retryAfter;

  const exponential = DEFAULT_RETRY_BASE_MS * (2 ** attempt);
  const jitter = Math.floor(Math.random() * 250);
  return exponential + jitter;
}

async function processQueue() {
  if (processing) return;
  processing = true;

  try {
    while (queue.length > 0) {
      if (activeCount >= DEFAULT_MAX_CONCURRENT) {
        await wait(20);
        continue;
      }

      const elapsed = Date.now() - lastStartedAt;
      if (lastStartedAt && elapsed < DEFAULT_MIN_GAP_MS) {
        await wait(DEFAULT_MIN_GAP_MS - elapsed);
      }

      const next = queue.shift();
      if (!next) continue;

      activeCount += 1;
      lastStartedAt = Date.now();

      Promise.resolve()
        .then(next.task)
        .then((value) => {
          if (next.key && next.cacheTtlMs > 0) {
            cache.set(next.key, {
              value,
              expiresAt: Date.now() + next.cacheTtlMs,
            });
          }
          next.resolve(value);
        })
        .catch(next.reject)
        .finally(() => {
          activeCount -= 1;
          if (next.key) inflight.delete(next.key);
          processQueue();
        });
    }
  } finally {
    processing = false;
    if (queue.length > 0) processQueue();
  }
}

export function scheduleRequest(task, { key, cacheTtlMs = 0 } = {}) {
  const cached = readCache(key);
  if (cached !== null) return Promise.resolve(cached);

  if (key && inflight.has(key)) {
    return inflight.get(key);
  }

  const promise = new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject, key, cacheTtlMs });
    processQueue();
  });

  if (key) inflight.set(key, promise);
  return promise;
}

export async function pacedJsonFetch(url, init, { key, cacheTtlMs = 0, retries = DEFAULT_RETRY_COUNT } = {}) {
  return scheduleRequest(async () => {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const response = await fetch(url, init);

      if (response.ok) {
        return response.json();
      }

      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      error.url = String(url);
      lastError = error;

      const shouldRetry = RETRYABLE_STATUSES.has(response.status) && attempt < retries;
      if (!shouldRetry) {
        throw error;
      }

      await wait(getRetryDelayMs(response, attempt));
    }

    throw lastError || new Error('Request failed');
  }, { key, cacheTtlMs });
}
