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
        auth: false,
        policies: [],
        middlewares: [],
        description: 'Increment download count for a program',
        tag: {
          plugin: 'programs',
          name: 'Program - Analytics',
        },
        documentation: {
          description: 'Increments the download counter for a program. Call this when a user initiates a download.',
          parameters: [
            {
              name: 'id',
              in: 'path',
              description: 'The documentId of the program',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            200: {
              description: 'Download count incremented successfully',
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
                          name: { type: 'string' },
                          downloads: { type: 'integer' },
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
            404: { description: 'Program not found' },
          },
        },
      },
    },
  ],
};
