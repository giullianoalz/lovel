import rateLimit from 'express-rate-limit';
import { createHash } from 'crypto';

/**
 * Client identity at the transport level.
 *
 * IPv6 is collapsed to its /64 prefix: providers hand a single subscriber a
 * whole /64, so keying on the full address would let one client walk through
 * billions of addresses and get a fresh bucket for each.
 *
 * Requires `trust proxy` to be set (see index.js) — behind Render's load
 * balancer an untrusted `req.ip` is the balancer's own address, which would put
 * every user in the world into one shared bucket.
 */
const ipKey = (req) => {
  const ip = req.ip || '';
  if (ip.includes(':')) return ip.split(':').slice(0, 4).join(':') + '::/64';
  return ip;
};

/**
 * Per-credential key, used to subdivide a shared IP — never to replace it.
 *
 * Keying by IP alone breaks real usage: families on a shared network (the
 * academy's Wi-Fi, an apartment building, school NAT) all present the same IP
 * and exhaust each other's quota. The token is hashed because the raw JWT is
 * ~1 KB and shouldn't sit in the limiter's key store; hashing the whole token
 * (not a prefix — Firebase JWTs share their first segments across users)
 * keeps keys unique per session.
 *
 * Note what this key cannot do on its own: the token is unverified at this
 * point in the stack, so a caller can mint a new bucket for every request just
 * by varying the string. That is why `ipLimiter` below runs first and is keyed
 * on something the caller cannot choose.
 */
const perCredentialKey = (req) => {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    return 'tok:' + createHash('sha256').update(auth).digest('base64url').slice(0, 24);
  }
  const devEmail = req.headers['x-dev-user-email'];
  if (devEmail) return `dev:${devEmail}`;
  return ipKey(req);
};

const isDev = process.env.NODE_ENV === 'development';

/**
 * Backstop: a ceiling per client IP that no header can move.
 *
 * Deliberately loose. It is not the fairness mechanism — `apiLimiter` is — it
 * only exists so an anonymous caller rotating `Authorization` values can't
 * issue unbounded requests. Tune it down if the API is ever fronted by a CDN
 * or the academy stops sharing one NAT; the number below assumes a whole site
 * (staff + families on tablets) can appear as a single address, so it has to
 * clear a busy afternoon without locking the building out.
 */
export const ipLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 20000 : 5000,
  keyGenerator: ipKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too Many Requests',
    message: 'You have exceeded the rate limit. Please try again later.',
  },
});

/**
 * General API rate limiter
 * 1000 requests per 15 minutes per credential (or per IP when anonymous).
 * A normal SPA session fires several calls per screen; 100 was low enough to
 * 429 a single legitimate user mid-session.
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 10000 : 1000,
  keyGenerator: perCredentialKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too Many Requests',
    message: 'You have exceeded the rate limit. Please try again later.',
  },
});

/**
 * Strict rate limiter for auth endpoints
 * 10 requests per 15 minutes per client IP.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: ipKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too Many Requests',
    message: 'Too many authentication attempts. Please wait 15 minutes.',
  },
});

/**
 * Webhook rate limiter (more generous for Stripe webhooks)
 * 500 requests per 15 minutes per IP
 */
export const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  keyGenerator: ipKey,
  standardHeaders: true,
  legacyHeaders: false,
});
