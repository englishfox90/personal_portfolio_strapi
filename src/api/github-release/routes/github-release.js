module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/github-release/:repo',
      handler: 'github-release.getLatestRelease',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
        description: 'Get latest GitHub release for a repository',
        tag: {
          plugin: 'github-release',
          name: 'GitHub Release',
        },
        documentation: {
          description: 'Fetches the latest release data from GitHub for the specified repository. Data is cached for 1 hour. Also syncs version/download link to matching Program entries.',
          parameters: [
            {
              name: 'repo',
              in: 'path',
              description: 'The GitHub repository name (owner is always englishfox90)',
              required: true,
              schema: { type: 'string' },
              example: 'ASIOverlayWatchdog',
            },
          ],
          responses: {
            200: {
              description: 'Release data retrieved successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          name: { type: 'string', example: 'v2.4.2' },
                          tagName: { type: 'string', example: 'v2.4.2' },
                          body: { type: 'string', description: 'Release notes' },
                          htmlUrl: { type: 'string', format: 'uri' },
                          publishedAt: { type: 'string', format: 'date-time' },
                          assets: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: {
                                name: { type: 'string' },
                                size: { type: 'integer' },
                                downloadCount: { type: 'integer' },
                                browserDownloadUrl: { type: 'string', format: 'uri' },
                              },
                            },
                          },
                        },
                      },
                      meta: {
                        type: 'object',
                        properties: {
                          cached: { type: 'boolean' },
                          cachedAt: { type: 'string', format: 'date-time' },
                          expiresAt: { type: 'string', format: 'date-time' },
                        },
                      },
                    },
                  },
                },
              },
            },
            404: { description: 'Repository or release not found' },
            429: { description: 'GitHub API rate limit exceeded' },
          },
        },
      },
    },
  ],
};
