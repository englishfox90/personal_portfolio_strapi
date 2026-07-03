module.exports = ({ env }) => [
  'strapi::logger',
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", 'https:'],
          'img-src': [
            "'self'",
            'data:',
            'blob:',
            'https://market-assets.strapi.io',
            // Railway bucket endpoint (signed URLs are path-style on this host)
            env('AWS_ENDPOINT_URL', 'https://storage.railway.app'),
          ],
          'media-src': [
            "'self'",
            'data:',
            'blob:',
            'https://market-assets.strapi.io',
            env('AWS_ENDPOINT_URL', 'https://storage.railway.app'),
          ],
          upgradeInsecureRequests: null,
        },
      },
    },
  },
  {
    // Pinned CORS: only the production frontend (and localhost for dev) may
    // make cross-origin requests. Strapi's default reflects ANY Origin with
    // credentials enabled — do not revert to bare 'strapi::cors'.
    name: 'strapi::cors',
    config: {
      origin: env.array('CORS_ORIGINS', [
        'https://www.pfrastro.com',
        'https://pfrastro.com',
        'http://localhost:3000',
      ]),
      credentials: false,
    },
  },
  // Rate limiting for unauthenticated public endpoints (counters, comments,
  // signed URLs). Placed right after CORS so 429 responses still carry CORS
  // headers, and before query/body parsing so throttled requests stay cheap.
  {
    name: 'global::rate-limit',
    config: {
      enabled: env.bool('RATE_LIMIT_ENABLED', true),
      windowMs: env.int('RATE_LIMIT_WINDOW_MS', 60000),
      commentsMax: env.int('RATE_LIMIT_COMMENTS_MAX', 10),
      countersMax: env.int('RATE_LIMIT_COUNTERS_MAX', 30),
      signedUrlMax: env.int('RATE_LIMIT_SIGNED_URL_MAX', 60),
    },
  },
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
