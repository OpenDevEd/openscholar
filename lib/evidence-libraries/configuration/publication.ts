import type {
  PublicationSettings,
  PublicationSecrets,
} from "@/convex/evidenceLibraries/publicationValidators";
import { validateSectionStructure } from "./generated-validation";

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

export function buildPublicationConfiguration(
  settings: PublicationSettings,
  secrets: PublicationSecrets,
) {
  const { crossref, zenodo } = settings;
  if (crossref.mode !== "off" && zenodo.mode === "off")
    throw new Error("Crossref requires Zenodo archiving. Enable Zenodo first.");
  if (crossref.mode === "custom" && zenodo.mode === "sandbox")
    throw new Error("Production Crossref requires production Zenodo. Use custom Zenodo credentials.");
  if (
    zenodo.mode !== "off" &&
    zenodo.defaultIdentifierPolicy === "reuse-crossref" &&
    crossref.mode === "off"
  )
    throw new Error("Reusing a Crossref DOI requires Crossref to be enabled.");
  if (crossref.mode !== "off") {
    for (const [value, label] of [
      [crossref.prefix, "DOI prefix"],
      [crossref.suffixNamespace, "DOI namespace"],
      [crossref.depositorName, "depositor name"],
      [crossref.email, "depositor email"],
      [crossref.registrant, "registrant"],
      [secrets.crossrefLoginId, "Crossref login"],
      [secrets.crossrefPassword, "Crossref password"],
    ]) {
      if (!value?.trim()) throw new Error(`Enter the ${label}.`);
    }
  }
  if (zenodo.mode !== "off" && !secrets.zenodoToken?.trim())
    throw new Error("Enter a Zenodo token.");
  const publication = {
    crossref:
      crossref.mode === "off"
        ? { enabled: false }
        : {
            enabled: true,
            environment: crossref.mode === "sandbox" ? "test" : "production",
            prefix: crossref.prefix,
            suffixNamespace: crossref.suffixNamespace,
            depositorName: crossref.depositorName,
            email: crossref.email,
            registrant: crossref.registrant,
            loginId: secrets.crossrefLoginId,
            password: secrets.crossrefPassword,
          },
    zenodo:
      zenodo.mode === "off"
        ? { enabled: false }
        : {
            enabled: true,
            environment: zenodo.mode === "sandbox" ? "sandbox" : "production",
            license: zenodo.license,
            defaultIdentifierPolicy: zenodo.defaultIdentifierPolicy,
            accessRight: "open",
            token: secrets.zenodoToken,
          },
  };
  // Reuse the runtime contract. Other managed service fields are assembled at deployment.
  const issues = validateSectionStructure("services", {
    publication,
  }).issues.filter((issue) =>
    issue.pointer.startsWith("/services/publication/"),
  );
  if (issues.length)
    throw new Error(
      `${issues[0].pointer.split("/").at(-1)}: ${issues[0].message}`,
    );
  return publication;
}
