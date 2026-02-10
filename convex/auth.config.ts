const clientId = process.env.WORKOS_CLIENT_ID!;

const authConfig = {
  providers: [
    {
      type: "customJwt",
      issuer: "https://api.workos.com",
      jwks: "https://api.workos.com/sso/jwks",
      algorithm: "RS256",
      applicationID: clientId,
    },
    {
      type: "customJwt",
      issuer: `https://api.workos.com/user_management/${clientId}`,
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
      algorithm: "RS256",
    },
  ],
};

export default authConfig;
