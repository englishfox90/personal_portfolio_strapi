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
        auth: false,
        policies: [],
        middlewares: [],
        description: 'Increment view count for a portfolio entry',
        tag: {
          plugin: 'portfolio-entries',
          name: 'Portfolio Entry - Analytics',
        },
        documentation: {
          description: 'Increments the view counter for a portfolio entry. Call this when a user views the portfolio page.',
          parameters: [
            {
              name: 'id',
              in: 'path',
              description: 'The documentId of the portfolio entry',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            200: {
              description: 'View count incremented successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          id: { type: 'integer' },
                          documentId: { type: 'string' },
                          title: { type: 'string' },
                          views: { type: 'integer' },
                        },
                      },
                      meta: {
                        type: 'object',
                        properties: {
                          previousCount: { type: 'integer' },
                          newCount: { type: 'integer' },
                        },
                      },
                    },
                  },
                },
              },
            },
            404: { description: 'Portfolio entry not found' },
          },
        },
      },
    },
  ],
};
