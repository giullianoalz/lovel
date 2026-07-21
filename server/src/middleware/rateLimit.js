import rateLimit from 'express-rate-limit';
import { createHash } from 'crypto';

/**
 * Rate-limit key: per credential when the request carries one, per IP only as
 * a fallback for unauthenticated traffic.
 *
 * Keying by IP alone breaks real usage: families on a shared network (the
 * academy's Wi-Fi, an apartment building, school NAT) all present the same IP
 * and exhaust each other's quota. The token is hashed because the raw JWT is
 * ~1 KB and shouldn't sit in the limiter's key store; hashing the whole token
 * (not a prefix — Firebase JWTs share their first segments across users)
 * keeps keys unique per session.
 */
const perCredentialKey = (req) => {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    return 'tok:' + createHash('sha256').update(auth).digest('base64url').slice(0, 24);
  }
  const devEmail = req.headers['x-dev-user-email'];
  if (devEmail) return `dev:${devEmail}`;
  return req.ip; // same fallback the library's default keyGenerator uses (v7)
};

/**
 * General API rate limiter
 * 1000 requests per 15 minutes per credential (or per IP when anonymous).
 * A normal SPA session fires several calls per screen; 100 was low enough to
 * 429 a single legitimate user mid-session.
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'development' ? 10000 : 1000,
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
 * 10 requests per 15 minutes per IP
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
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
  standardHeaders: true,
  legacyHeaders: false,
});
