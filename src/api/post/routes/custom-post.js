'use strict';

/**
 * Custom post routes
 */

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/posts/:id/view',
      handler: 'post.incrementView',
      config: {
        auth: false, // Public endpoint
        policies: [],
        middlewares: [],
      },
    },
  ],
};
