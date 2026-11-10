import type { PublicationSettings } from "@/convex/evidenceLibraries/publicationValidators";

// Kept apart from `publication.ts`, which loads the 4 MB generated validator, so a module that only reads these stays light.
export const PUBLICATION_CREDENTIAL_KEY = "publication-providers";
export const EMPTY_PUBLICATION_SETTINGS: PublicationSettings = {
  zenodo: {
    mode: "off",
    license: "cc-by-4.0",
    defaultIdentifierPolicy: "mint-zenodo",
  },
  crossref: {
    mode: "off",
    prefix: "",
    suffixNamespace: "",
    depositorName: "",
    email: "",
    registrant: "",
  },
};
