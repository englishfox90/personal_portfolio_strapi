module.exports = ({ env }) => ({
  auth: {
    secret: env('ADMIN_JWT_SECRET'),
    // New session-based auth config (replaces deprecated expiresIn)
    sessions: {
      maxRefreshTokenLifespan: '30d', // 30 days
      maxSessionLifespan: '7d', // 7 days
    },
  },
  apiToken: {
    salt: env('API_TOKEN_SALT'),
  },
  transfer: {
    token: {
      salt: env('TRANSFER_TOKEN_SALT'),
    },
  },
  flags: {
    nps: env.bool('FLAG_NPS', true),
    promoteEE: env.bool('FLAG_PROMOTE_EE', true),
  },
  // Disable preview feature to prevent "Preview config not found" error
  // Enable and configure this when you're ready to use Preview with your frontend
  preview: {
    enabled: false,
  },
});
