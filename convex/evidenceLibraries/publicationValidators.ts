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

/**
 * The own Crossref account's details, kept while Crossref runs on the sandbox, so switching back to it needs nothing
 * typed again. Not secret: they sit in the settings as they are while it's in use. Its login, password and Zenodo's
 * token are kept beside them, encrypted (`encryptedCustomCredentials`).
 */
export const customCrossrefValidator = v.object({
  prefix: v.string(),
  depositorName: v.string(),
  email: v.string(),
  registrant: v.string(),
});
export type CustomCrossref = Infer<typeof customCrossrefValidator>;
/** The own accounts kept, as stored in the clear and shown to the form: Crossref's details, and which secrets are kept. */
export const keptCustomValidator = v.object({
  crossref: v.union(customCrossrefValidator, v.null()),
  zenodoToken: v.boolean(),
  crossrefLogin: v.boolean(),
});

export const publicationPayloadValidator = v.object({
  settings: publicationSettingsValidator,
  encryptedCredentials: v.string(),
});

/**
 * The own accounts kept, for the form: as stored, or, from a save before they were kept apart, the ones in use when
 * they were custom.
 */
export function keptCustomOf(settings: PublicationSettings, stored: Infer<typeof keptCustomValidator> | undefined): Infer<typeof keptCustomValidator> {
  if (stored) return stored;
  const crossref = settings.crossref.mode === "custom";
  return {
    crossref: crossref ? { prefix: settings.crossref.prefix, depositorName: settings.crossref.depositorName, email: settings.crossref.email, registrant: settings.crossref.registrant } : null,
    zenodoToken: settings.zenodo.mode === "custom",
    crossrefLogin: crossref,
  };
}
