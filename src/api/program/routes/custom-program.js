'use strict';

/**
 * Custom program routes
 */

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/programs/:id/download',
      handler: 'program.incrementDownload',
      config: {
        auth: false, // Public endpoint - anyone can increment
        policies: [],
        middlewares: [],
      },
    },
  ],
};
