import { v, type Infer } from "convex/values";

const mode = v.union(
  v.literal("off"),
  v.literal("sandbox"),
  v.literal("custom"),
);
export const publicationSettingsValidator = v.object({
  zenodo: v.object({
    mode,
    license: v.string(),
    defaultIdentifierPolicy: v.union(
      v.literal("mint-zenodo"),
      v.literal("reuse-crossref"),
    ),
  }),
  crossref: v.object({
    mode,
    prefix: v.string(),
    suffixNamespace: v.string(),
    depositorName: v.string(),
    email: v.string(),
    registrant: v.string(),
  }),
});
export type PublicationSettings = Infer<typeof publicationSettingsValidator>;

export const publicationSecretsValidator = v.object({
  zenodoToken: v.optional(v.string()),
  crossrefLoginId: v.optional(v.string()),
  crossrefPassword: v.optional(v.string()),
});
export type PublicationSecrets = Infer<typeof publicationSecretsValidator>;

export const publicationPayloadValidator = v.object({
  settings: publicationSettingsValidator,
  encryptedCredentials: v.string(),
});
