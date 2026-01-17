const authConfig = {
  providers: [
    {
      type: "customJwt" as const,
      applicationID: "client_01KDS144HBFF2SHD9F1XTSVYD3",
      issuer: "https://caring-grass-86-staging.authkit.app",
      jwks: "https://caring-grass-86-staging.authkit.app/oauth2/jwks",
      algorithm: "RS256" as const,
    },
  ],
};

export default authConfig;
