'use strict';

/**
 * program controller
 * 
 * Extended to support GitHub release data synchronization
 * and download tracking.
 */

const { createCoreController } = require('@strapi/strapi').factories;

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
      // Find the program
      const program = await strapi.documents('api::program.program').findOne({
        documentId: id,
      });

      if (!program) {
        return ctx.notFound('Program not found');
      }

      // Increment the download count
      const currentDownloads = program.downloads || 0;
      const updated = await strapi.documents('api::program.program').update({
        documentId: id,
        data: {
          downloads: currentDownloads + 1,
        },
      });

      strapi.log.info(`Download count incremented for "${program.name}": ${currentDownloads} -> ${currentDownloads + 1}`);

      return ctx.send({
        data: {
          id: updated.id,
          documentId: updated.documentId,
          name: updated.name,
          downloads: updated.downloads,
        },
        meta: {
          previousCount: currentDownloads,
          newCount: updated.downloads,
        },
      });
    } catch (error) {
      strapi.log.error(`Failed to increment download count: ${error.message}`);
      return ctx.internalServerError('Failed to increment download count');
    }
  },
}));
