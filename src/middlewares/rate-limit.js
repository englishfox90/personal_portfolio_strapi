'use strict';

/**
 * Global rate-limiting middleware (registered in config/middlewares.js as
 * 'global::rate-limit').
 *
 * In-memory sliding-window limiter, per client IP, applied only to the
 * unauthenticated public endpoints that can be abused:
 *   - POST /api/comments/...            (comment creation / abuse reports)
 *   - POST /api/.../view, .../download  (analytics counters)
 *   - signed-url endpoints              (private-bucket URL signing)
 *
 * NOTE: state is per-process. On Railway with a single instance that's fine;
 * if the service is ever scaled horizontally each replica enforces its own
 * window (effective limit = N x configured limit) — move to a shared store
 * (e.g. Redis) at that point.
 */

const WINDOW_MS_DEFAULT = 60 * 1000; // 1 minute sliding window

// Maximum number of (rule, ip) buckets kept in memory before forced cleanup.
const MAX_BUCKETS = 20000;

/**
 * Client IP resolution. config/server.js sets `proxy: true`, so Koa's ctx.ip
 * already resolves the client address from X-Forwarded-For using its
 * trusted-proxy logic. Do NOT parse the header manually: the first XFF entry
 * is client-supplied and trivially spoofable, which would let an attacker
 * mint a fresh rate-limit bucket per request.
 */
const getClientIp = (ctx) => ctx.ip || ctx.request.ip || 'unknown';

module.exports = (config, { strapi }) => {
  const windowMs = config.windowMs || WINDOW_MS_DEFAULT;
  const enabled = config.enabled !== false;

  // Each rule: name, HTTP methods, path regex, max requests per window.
  //
  // skipAuthorized: comment/counter traffic from real users arrives via the
  // website's Next.js server-side proxies, which all share ONE egress IP and
  // always send the (secret, server-only) API bearer token. Rate-limiting
  // that path per IP would throttle all legitimate users collectively - the
  // per-user limits already live in the Next.js proxy routes. Requests
  // carrying an Authorization header are therefore exempt here: a forged
  // bearer is rejected with 401 by Strapi's auth before reaching any
  // controller, so this doesn't reopen anonymous abuse. Direct anonymous
  // hits (no Authorization) stay limited. The signed-url endpoints are
  // called directly by visitors' browsers without auth, so that rule
  // applies to everyone.
  const rules = [
    {
      name: 'comments',
      methods: ['POST', 'PUT'],
      // strapi-plugin-comments client routes: POST /api/comments/:relation,
      // PUT /api/comments/:relation/comment/:commentId,
      // POST /api/comments/:relation/comment/:commentId/report-abuse
      pattern: /^\/api\/comments\//,
      max: config.commentsMax || 10,
      skipAuthorized: true,
    },
    {
      name: 'counters',
      methods: ['POST'],
      // POST /api/portfolio-entries/:id/view, /api/posts/:id/view,
      // POST /api/programs/:id/download
      pattern: /^\/api\/(?:portfolio-entries|posts)\/[^/]+\/view$|^\/api\/programs\/[^/]+\/download$/,
      max: config.countersMax || 30,
      skipAuthorized: true,
    },
    {
      name: 'signed-url',
      methods: ['GET', 'POST'],
      // POST /api/signed-url, POST /api/signed-urls,
      // GET /api/signed-url/:key, GET /api/image/:key
      pattern: /^\/api\/(?:signed-url(?:s)?(?:\/|$)|image\/)/,
      max: config.signedUrlMax || 60,
    },
  ];

  // bucketKey ("rule:ip") -> array of request timestamps within the window
  const buckets = new Map();
  let lastSweep = Date.now();

  const sweep = (now) => {
    for (const [key, timestamps] of buckets.entries()) {
      const cutoff = now - windowMs;
      const alive = timestamps.filter((t) => t > cutoff);
      if (alive.length === 0) {
        buckets.delete(key);
      } else {
        buckets.set(key, alive);
      }
    }
    lastSweep = now;
  };

  return async (ctx, next) => {
    if (!enabled) {
      return next();
    }

    const rule = rules.find(
      (r) => r.methods.includes(ctx.method) && r.pattern.test(ctx.path)
    );
    if (!rule) {
      return next();
    }

    if (rule.skipAuthorized && ctx.get('authorization')) {
      return next();
    }

    const now = Date.now();

    // Periodic cleanup so idle buckets don't accumulate forever
    if (now - lastSweep > windowMs || buckets.size > MAX_BUCKETS) {
      sweep(now);
    }

    const ip = getClientIp(ctx);
    const bucketKey = `${rule.name}:${ip}`;
    const cutoff = now - windowMs;

    const timestamps = (buckets.get(bucketKey) || []).filter((t) => t > cutoff);

    if (timestamps.length >= rule.max) {
      const oldest = timestamps[0];
      const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      ctx.set('Retry-After', String(retryAfterSec));
      ctx.status = 429;
      ctx.body = {
        data: null,
        error: {
          status: 429,
          name: 'TooManyRequestsError',
          message: 'Too many requests, please try again later.',
          details: { retryAfter: retryAfterSec },
        },
      };
      strapi.log.warn(
        `Rate limit exceeded: rule=${rule.name} ip=${ip} path=${ctx.path}`
      );
      return;
    }

    timestamps.push(now);
    buckets.set(bucketKey, timestamps);

    return next();
  };
};
