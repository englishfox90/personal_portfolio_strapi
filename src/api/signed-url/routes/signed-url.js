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
    {
      // GET endpoint - more CDN-friendly for single file
      method: 'GET',
      path: '/signed-url/:key',
      handler: 'signed-url.getSignedUrlByKey',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      // Image redirect endpoint - most performant for direct <img src="...">
      // Use this as: <img src="https://api.pfrastro.com/api/image/filename.png" />
      method: 'GET',
      path: '/image/:key',
      handler: 'signed-url.redirectToSignedUrl',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};
