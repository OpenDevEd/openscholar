module.exports = {
  apps: [
    {
      name: 'next',
      script: 'npm',
      args: 'run dev',
      env: {
        NODE_ENV: 'development',
      },
    },
    {
      name: 'convex',
      script: 'npm',
      args: 'run dev:convex',
    }
  ],
};
