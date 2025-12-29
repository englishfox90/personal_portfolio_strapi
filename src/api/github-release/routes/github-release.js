module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/github-release/:repo',
      handler: 'github-release.getLatestRelease',
      config: {
        auth: false, // Public endpoint
        policies: [],
        middlewares: [],
      },
    },
  ],
};
