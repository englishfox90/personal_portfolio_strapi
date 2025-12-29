'use strict';

/**
 * portfolio-entry controller
 * 
 * Extended to support view tracking.
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::portfolio-entry.portfolio-entry', ({ strapi }) => ({
  /**
   * Increment view count for a portfolio entry
   * POST /api/portfolio-entries/:id/view
   */
  async incrementView(ctx) {
    const { id } = ctx.params;

    if (!id) {
      return ctx.badRequest('Portfolio entry ID is required');
    }

    try {
      // Find the portfolio entry
      const entry = await strapi.documents('api::portfolio-entry.portfolio-entry').findOne({
        documentId: id,
      });

      if (!entry) {
        return ctx.notFound('Portfolio entry not found');
      }

      // Increment the view count
      const currentViews = entry.views || 0;
      const updated = await strapi.documents('api::portfolio-entry.portfolio-entry').update({
        documentId: id,
        data: {
          views: currentViews + 1,
        },
        status: 'published', // Ensure changes are published immediately
      });

      strapi.log.debug(`View count incremented for portfolio "${entry.title}": ${currentViews} -> ${currentViews + 1}`);

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
