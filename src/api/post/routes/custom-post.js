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
        auth: false,
        policies: [],
        middlewares: [],
        description: 'Increment view count for a blog post',
        tag: {
          plugin: 'posts',
          name: 'Post - Analytics',
        },
        documentation: {
          description: 'Increments the view counter for a blog post. Call this when a user views the blog post page.',
          parameters: [
            {
              name: 'id',
              in: 'path',
              description: 'The documentId of the blog post',
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
            404: { description: 'Post not found' },
          },
        },
      },
    },
  ],
};
