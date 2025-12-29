'use strict';

/**
 * Custom portfolio-entry routes
 */

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/portfolio-entries/:id/view',
      handler: 'portfolio-entry.incrementView',
      config: {
        auth: false, // Public endpoint
        policies: [],
        middlewares: [],
      },
    },
  ],
};
