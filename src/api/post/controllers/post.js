'use strict';

/**
 * post controller
 * 
 * Extended to support view tracking.
 */

const { createCoreController } = require('@strapi/strapi').factories;
const { incrementCounter } = require('../../../utils/increment-counter');

module.exports = createCoreController('api::post.post', ({ strapi }) => ({
  /**
   * Increment view count for a blog post
   * POST /api/posts/:id/view
   */
  async incrementView(ctx) {
    const { id } = ctx.params;

    if (!id) {
      return ctx.badRequest('Post ID is required');
    }

    try {
      // Never publish here - see src/utils/increment-counter.js
      const result = await incrementCounter(strapi, 'api::post.post', id, 'views', ['title']);

      if (!result) {
        return ctx.notFound('Post not found');
      }

      strapi.log.debug(`View count incremented for "${result.row.title}": ${result.previous} -> ${result.value}`);

      return ctx.send({
        data: {
          id: result.id,
          documentId: result.documentId,
          title: result.row.title,
          views: result.value,
        },
        meta: {
          previousCount: result.previous,
          newCount: result.value,
        },
      });
    } catch (error) {
      strapi.log.error(`Failed to increment view count: ${error.message}`);
      return ctx.internalServerError('Failed to increment view count');
    }
  },
}));
