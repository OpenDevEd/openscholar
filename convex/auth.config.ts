const clientId = process.env.WORKOS_CLIENT_ID!;

const authConfig = {
  providers: [
    {
      type: "customJwt" as const,
      issuer: `https://api.workos.com/user_management/${clientId}`,
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
      algorithm: "RS256" as const,
    },
  ],
};

export default authConfig;
