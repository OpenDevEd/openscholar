import type { AuthConfig } from "convex/server";

const issuer = process.env.CLERK_JWT_ISSUER_DOMAIN!;

export default {
  providers: [
    // Openscholar's own pages: Clerk's session token from the "convex" template.
    { domain: issuer, applicationID: "convex" },
    // Developer apps (convex/developerApps): Clerk's OAuth access tokens, issued for this deployment by
    // the `resource` an app asks for. Its own audience keeps out ID tokens and tokens issued for anything
    // else; getIdentity (convex/lib/auth.ts) then accepts only an app someone made on Openscholar.
    {
      type: "customJwt",
      issuer,
      jwks: `${issuer}/.well-known/jwks.json`,
      algorithm: "RS256",
      applicationID: process.env.CONVEX_CLOUD_URL!,
    },
  ],
} satisfies AuthConfig;
