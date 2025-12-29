'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/signed-url',
      handler: 'signed-url.getSignedUrl',
      config: {
        auth: false, // Public endpoint - adjust if you need authentication
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/signed-urls',
      handler: 'signed-url.getSignedUrls',
      config: {
        auth: false, // Public endpoint - adjust if you need authentication
        policies: [],
        middlewares: [],
      },
    },
  ],
};
