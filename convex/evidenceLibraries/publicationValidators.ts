import { v, type Infer } from "convex/values";
import { capped } from "../lib/listCaps";

/** The most entries kept of each of DOCiD's lists: it has under twenty of each. */
export const DOCID_OPTIONS_MAX = 200;

const mode = v.union(
  v.literal("off"),
  v.literal("sandbox"),
  v.literal("custom"),
);
export const publicationSettingsValidator = v.object({
  zenodo: v.object({
    // `own`: a community's owner's own Zenodo account, connected on Openscholar (#1237), never Openscholar Reports'.
    mode: v.union(mode, v.literal("own")),
    /** Whose connected account `own` deposits in: the person who saved it. */
    ownerUserId: v.optional(v.id("users")),
    license: v.string(),
    /** Who gets the files of records made in the community, unless their editor chooses: anyone when none is saved. */
    defaultFileAccess: v.optional(v.union(v.literal("open"), v.literal("private"), v.literal("readers"))),
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
  /**
   * DOCiD, the Africa PID Alliance's Handles (plans/identifier-services): Openscholar Reports' account only, as
   * communities show the DOCiDs their records come with and never register one. Its sandbox is our account on
   * DOCiD's demo. Its types are mapped from each report, by name, against DOCiD's lists.
   */
  docid: v.optional(
    v.object({
      mode,
      email: v.string(),
      /** DOCiD's lists as the account saw them when last verified, which deposits find their types in; written by the server only. */
      options: v.optional(
        v.object({
          resourceTypes: capped(v.array(v.object({ id: v.number(), name: v.string() })), DOCID_OPTIONS_MAX),
          publicationTypes: capped(v.array(v.object({ id: v.number(), name: v.string() })), DOCID_OPTIONS_MAX),
          funderTypes: capped(v.array(v.object({ id: v.number(), name: v.string() })), DOCID_OPTIONS_MAX),
        }),
      ),
    }),
  ),
});
export type PublicationSettings = Infer<typeof publicationSettingsValidator>;

export const publicationSecretsValidator = v.object({
  zenodoToken: v.optional(v.string()),
  crossrefLoginId: v.optional(v.string()),
  crossrefPassword: v.optional(v.string()),
  docidPassword: v.optional(v.string()),
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
  /** The email of the account on DOCiD itself, and whether its password is kept. */
  docidEmail: v.optional(v.string()),
  docidPassword: v.optional(v.boolean()),
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
  const ownDocid = settings.docid?.mode === "custom" && { docidEmail: settings.docid.email, docidPassword: true };
  if (stored) return { ...stored, ...(stored.docidEmail === undefined && ownDocid) };
  const crossref = settings.crossref.mode === "custom";
  return {
    crossref: crossref ? { prefix: settings.crossref.prefix, depositorName: settings.crossref.depositorName, email: settings.crossref.email, registrant: settings.crossref.registrant } : null,
    zenodoToken: settings.zenodo.mode === "custom",
    crossrefLogin: crossref,
    ...ownDocid,
  };
}
