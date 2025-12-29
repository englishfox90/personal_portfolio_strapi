'use strict';

/**
 * github-release controller
 * 
 * Fetches latest release data from GitHub and caches it for 1 hour.
 * Also syncs data to matching Program entries in Strapi.
 */

// In-memory cache
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour in milliseconds
const GITHUB_OWNER = 'englishfox90';

/**
 * Fetch release data from GitHub API
 * @param {string} repo - Repository name
 * @returns {Promise<{data: object, fromCache: boolean}>}
 */
async function fetchGitHubRelease(repo) {
  const sanitizedRepo = repo.replace(/[^a-zA-Z0-9_.-]/g, '');
  const cacheKey = `github-release:${sanitizedRepo}`;

  // Check cache first
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    strapi.log.debug(`Cache hit for ${cacheKey}`);
    return { data: cached.data, fromCache: true, cached };
  }

  // Fetch from GitHub
  strapi.log.info(`Fetching release data for ${GITHUB_OWNER}/${sanitizedRepo}`);
  
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${sanitizedRepo}/releases/latest`,
    {
      headers: {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Strapi-Portfolio-App',
        ...(process.env.GITHUB_TOKEN && {
          'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
        }),
      },
    }
  );

  if (!response.ok) {
    const error = new Error(`GitHub API error: ${response.status}`);
    error.status = response.status;
    error.cached = cached; // Attach stale cache if available
    throw error;
  }

  const releaseData = await response.json();

  // Extract relevant fields
  const data = {
    name: releaseData.name,
    tagName: releaseData.tag_name,
    body: releaseData.body,
    htmlUrl: releaseData.html_url,
    publishedAt: releaseData.published_at,
    author: releaseData.author ? {
      login: releaseData.author.login,
      avatarUrl: releaseData.author.avatar_url,
      htmlUrl: releaseData.author.html_url,
    } : null,
    assets: releaseData.assets?.map((asset) => ({
      name: asset.name,
      size: asset.size,
      downloadCount: asset.download_count,
      browserDownloadUrl: asset.browser_download_url,
    })) || [],
    prerelease: releaseData.prerelease,
    draft: releaseData.draft,
    // Add total downloads across all assets
    totalDownloads: releaseData.assets?.reduce((sum, a) => sum + a.download_count, 0) || 0,
  };

  // Store in cache
  const now = Date.now();
  cache.set(cacheKey, {
    data,
    cachedAt: now,
    expiresAt: now + CACHE_TTL,
  });

  strapi.log.info(`Cached release data for ${cacheKey}, expires in 1 hour`);

  return { data, fromCache: false, cachedAt: now, expiresAt: now + CACHE_TTL };
}

/**
 * Update Program entry with GitHub release data
 * @param {string} repo - Repository name
 * @param {object} releaseData - GitHub release data
 */
async function syncProgramWithRelease(repo, releaseData) {
  try {
    // Find program by githubRepo field
    const programs = await strapi.documents('api::program.program').findMany({
      filters: { githubRepo: { $eqi: repo } },
      limit: 1,
    });

    if (programs.length === 0) {
      strapi.log.debug(`No program found with githubRepo: ${repo}`);
      return null;
    }

    const program = programs[0];
    
    // Get the primary download link (first .exe or first asset)
    const primaryAsset = releaseData.assets?.find(a => a.name.endsWith('.exe')) 
      || releaseData.assets?.[0];
    
    // Check if update is needed (only version and download link - NOT downloads count)
    // Downloads are tracked separately via the increment endpoint
    const needsUpdate = 
      program.latestVersion !== releaseData.tagName ||
      program.downloadLink !== primaryAsset?.browserDownloadUrl;

    if (!needsUpdate) {
      strapi.log.debug(`Program ${program.name} already up to date`);
      return program;
    }

    // Update the program entry (only version and download link)
    const updated = await strapi.documents('api::program.program').update({
      documentId: program.documentId,
      data: {
        latestVersion: releaseData.tagName,
        downloadLink: primaryAsset?.browserDownloadUrl || null,
      },
      status: 'published', // Ensure changes are published immediately
    });

    strapi.log.info(`Updated program "${program.name}" with release ${releaseData.tagName}`);
    return updated;
  } catch (error) {
    strapi.log.error(`Failed to sync program with release: ${error.message}`);
    return null;
  }
}

// Export for use by other controllers/services
module.exports = {
  fetchGitHubRelease,
  syncProgramWithRelease,
  
  async getLatestRelease(ctx) {
    const { repo } = ctx.params;

    if (!repo) {
      return ctx.badRequest('Repository name is required');
    }

    const sanitizedRepo = repo.replace(/[^a-zA-Z0-9_.-]/g, '');

    try {
      const result = await fetchGitHubRelease(sanitizedRepo);
      
      // Sync to Program entry if this is fresh data (not from cache)
      let programUpdated = null;
      if (!result.fromCache) {
        programUpdated = await syncProgramWithRelease(sanitizedRepo, result.data);
      }

      return ctx.send({
        data: result.data,
        meta: {
          cached: result.fromCache,
          cachedAt: new Date(result.cached?.cachedAt || result.cachedAt).toISOString(),
          expiresAt: new Date(result.cached?.expiresAt || result.expiresAt).toISOString(),
          programSynced: programUpdated ? true : false,
        },
      });
    } catch (error) {
      strapi.log.error(`Error fetching GitHub release: ${error.message}`);
      
      if (error.status === 404) {
        return ctx.notFound(`Repository or release not found: ${GITHUB_OWNER}/${sanitizedRepo}`);
      }
      
      if (error.status === 403) {
        strapi.log.warn('GitHub API rate limit may have been exceeded');
        if (error.cached) {
          return ctx.send({
            data: error.cached.data,
            meta: {
              cached: true,
              stale: true,
              cachedAt: new Date(error.cached.cachedAt).toISOString(),
              error: 'GitHub rate limit exceeded, serving stale data',
            },
          });
        }
        return ctx.tooManyRequests('GitHub API rate limit exceeded');
      }
      
      // Return stale cache if available
      if (error.cached) {
        return ctx.send({
          data: error.cached.data,
          meta: {
            cached: true,
            stale: true,
            cachedAt: new Date(error.cached.cachedAt).toISOString(),
            error: error.message,
          },
        });
      }

      return ctx.internalServerError('Failed to fetch release data from GitHub');
    }
  },
};
