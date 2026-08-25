import { LRUCache } from 'lru-cache';

// ─── Cache store ──────────────────────────────────────────────────────────────
// Single process-level LRU cache. Keys are strings, values are serialized JSON.
// Individual TTLs are set per route (see withCache below).
//
// Bounded by bytes as well as by count. A 500-entry cap alone counts a 2 KB
// term list and a 3 MB roster as one thing each, so the ceiling was really
// "500 times the largest response any cached route can produce" — unknowable,
// and the process only has ~320 MB of heap to spend (see the start script).
// `sizeCalculation` is charged the JSON length, which tracks the real cost
// closely enough to bound it; anything bigger than a single entry may be is
// simply not cached rather than evicting everything else to fit.
const MAX_CACHE_BYTES = 32 * 1024 * 1024;

const store = new LRUCache({
  max: 500,
  maxSize: MAX_CACHE_BYTES,
  maxEntrySize: 2 * 1024 * 1024,
  sizeCalculation: (value) => {
    try {
      // +1 so an empty body is never size 0, which lru-cache rejects.
      return JSON.stringify(value).length + 1;
    } catch {
      // Circular or otherwise unserialisable: it could never have been sent
      // as JSON anyway, so charge it enough to be evicted first.
      return MAX_CACHE_BYTES;
    }
  },
  ttl: 1000 * 60, // default 60 s — overridden per-route
  allowStale: false,
  updateAgeOnGet: false,
});

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Express middleware factory.
 *
 * Usage in a route file:
 *   router.get('/terms', authenticate, withCache('registration:terms', 120), getTerms);
 *
 * @param {string|((req)=>string)} keyOrFn
 *   Static string key OR a function that receives `req` and returns the key.
 *   Use a function for per-user routes, e.g. `req => \`portal:parent:${req.user.id}\``.
 * @param {number} ttlSeconds  Time-to-live in seconds.
 */
export function withCache(keyOrFn, ttlSeconds = 60) {
  return (req, res, next) => {
    const key = typeof keyOrFn === 'function' ? keyOrFn(req) : keyOrFn;

    const cached = store.get(key);
    if (cached !== undefined) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached);
    }

    // Monkey-patch res.json so we can intercept the response and store it
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      // Only cache successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        store.set(key, body, { ttl: ttlSeconds * 1000 });
      }
      res.setHeader('X-Cache', 'MISS');
      return originalJson(body);
    };

    next();
  };
}

/**
 * Invalidate one or more cache entries.
 *
 * Pass exact keys or a prefix string — all matching keys are evicted.
 *
 * @param {...string} patterns  Exact key OR prefix ending with ':*'
 *
 * Examples:
 *   invalidate('registration:terms')         // single key
 *   invalidate('portal:parent:*')            // all parent portal entries
 *   invalidate('announcements', 'portal:*')  // multiple patterns
 */
export function invalidate(...patterns) {
  for (const pattern of patterns) {
    if (pattern.endsWith(':*')) {
      const prefix = pattern.slice(0, -1); // remove trailing '*'
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) store.delete(key);
      }
    } else {
      store.delete(pattern);
    }
  }
}

/**
 * Returns current cache size and a list of active keys (dev/debug helper).
 * Wire to GET /api/admin/cache-stats if you want a runtime inspector.
 */
export function cacheStats() {
  return {
    size: store.size,
    // Bytes held and the ceiling they are held against — without these the
    // stats endpoint can say "500 entries" and still not tell you whether the
    // cache is about to be the reason the process runs out of memory.
    bytes: store.calculatedSize,
    maxBytes: MAX_CACHE_BYTES,
    keys: [...store.keys()],
  };
}
