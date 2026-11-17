'use strict';

/**
 * program controller
 * 
 * Extended to support GitHub release data synchronization
 * and download tracking.
 */

const { createCoreController } = require('@strapi/strapi').factories;
const { incrementCounter } = require('../../../utils/increment-counter');

module.exports = createCoreController('api::program.program', ({ strapi }) => ({
  /**
   * Find all programs - optionally sync GitHub data
   * Query param: ?syncGithub=true to refresh release data
   */
  async find(ctx) {
    const { syncGithub } = ctx.query;
    
    // Get programs first
    const response = await super.find(ctx);
    
    // If syncGithub is requested, update programs with GitHub repos
    if (syncGithub === 'true' && response.data) {
      const { fetchGitHubRelease, syncProgramWithRelease } = require('../../github-release/controllers/github-release');
      
      for (const program of response.data) {
        if (program.githubRepo) {
          try {
            const result = await fetchGitHubRelease(program.githubRepo);
            if (!result.fromCache) {
              await syncProgramWithRelease(program.githubRepo, result.data);
            }
          } catch (error) {
            strapi.log.warn(`Failed to sync GitHub for ${program.githubRepo}: ${error.message}`);
          }
        }
      }
      
      // Re-fetch to get updated data
      return super.find(ctx);
    }
    
    return response;
  },

  /**
   * Find one program - optionally sync GitHub data
   * Query param: ?syncGithub=true to refresh release data
   */
  async findOne(ctx) {
    const { syncGithub } = ctx.query;
    
    // Get program first
    const response = await super.findOne(ctx);
    
    // If syncGithub is requested and program has a GitHub repo
    if (syncGithub === 'true' && response.data?.githubRepo) {
      const { fetchGitHubRelease, syncProgramWithRelease } = require('../../github-release/controllers/github-release');
      
      try {
        const result = await fetchGitHubRelease(response.data.githubRepo);
        if (!result.fromCache) {
          await syncProgramWithRelease(response.data.githubRepo, result.data);
          // Re-fetch to get updated data
          return super.findOne(ctx);
        }
      } catch (error) {
        strapi.log.warn(`Failed to sync GitHub for ${response.data.githubRepo}: ${error.message}`);
      }
    }
    
    return response;
  },

  /**
   * Increment download count for a program
   * POST /api/programs/:id/download
   */
  async incrementDownload(ctx) {
    const { id } = ctx.params;

    if (!id) {
      return ctx.badRequest('Program ID is required');
    }

    try {
      // Never publish here - see src/utils/increment-counter.js
      const result = await incrementCounter(strapi, 'api::program.program', id, 'downloads', ['name']);

      if (!result) {
        return ctx.notFound('Program not found');
      }

      strapi.log.info(`Download count incremented for "${result.row.name}": ${result.previous} -> ${result.value}`);

      return ctx.send({
        data: {
          id: result.id,
          documentId: result.documentId,
          name: result.row.name,
          downloads: result.value,
        },
        meta: {
          previousCount: result.previous,
          newCount: result.value,
        },
      });
    } catch (error) {
      strapi.log.error(`Failed to increment download count: ${error.message}`);
      return ctx.internalServerError('Failed to increment download count');
    }
  },
}));
