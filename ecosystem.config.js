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
      name: 'stripe',
      script: 'npm',
      args: 'run dev:stripe',
    },
    {
      name: 'convex',
      script: 'npm',
      args: 'run dev:convex',
    }
  ],
};
