const authConfig = {
  providers: [
    {
      type: "customJwt" as const,
      issuer: "https://api.workos.com/user_management/client_01KDS144HBFF2SHD9F1XTSVYD3",
      jwks: "https://api.workos.com/sso/jwks/client_01KDS144HBFF2SHD9F1XTSVYD3",
      algorithm: "RS256" as const,
    },
  ],
};

export default authConfig;
