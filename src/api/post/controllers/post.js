'use strict';

/**
 * post controller
 * 
 * Extended to support view tracking.
 */

const { createCoreController } = require('@strapi/strapi').factories;

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
      // Find the post
      const post = await strapi.documents('api::post.post').findOne({
        documentId: id,
      });

      if (!post) {
        return ctx.notFound('Post not found');
      }

      // Increment the view count
      const currentViews = post.views || 0;
      const updated = await strapi.documents('api::post.post').update({
        documentId: id,
        data: {
          views: currentViews + 1,
        },
      });

      strapi.log.debug(`View count incremented for post "${post.title}": ${currentViews} -> ${currentViews + 1}`);

      return ctx.send({
        data: {
          id: updated.id,
          documentId: updated.documentId,
          title: updated.title,
          views: updated.views,
        },
        meta: {
          previousCount: currentViews,
          newCount: updated.views,
        },
      });
    } catch (error) {
      strapi.log.error(`Failed to increment view count: ${error.message}`);
      return ctx.internalServerError('Failed to increment view count');
    }
  },
}));
