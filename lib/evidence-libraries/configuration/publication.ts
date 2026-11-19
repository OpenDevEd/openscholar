import type {
  PublicationSettings,
  PublicationSecrets,
} from "@/convex/evidenceLibraries/publicationValidators";
import { validateSectionStructure } from "./generated-validation";

export function buildPublicationConfiguration(
  settings: PublicationSettings,
  secrets: PublicationSecrets,
) {
  const { crossref, zenodo } = settings;
  // A DOI promises the work stays reachable, and Crossref's terms ask whoever registers it to have it archived.
  if (crossref.mode !== "off" && zenodo.mode === "off")
    throw new Error("Crossref requires Zenodo archiving. Enable Zenodo first.");
  if (crossref.mode === "custom" && zenodo.mode === "sandbox")
    throw new Error("Production Crossref requires production Zenodo. Use custom Zenodo credentials.");
  // Its own account is a real zenodo.org account: its records carry the community's real Crossref DOIs, never test ones.
  if (zenodo.mode === "own" && crossref.mode !== "custom")
    throw new Error("Archiving in your own Zenodo account needs your own Crossref account: a test DOI can't go on a real Zenodo record.");
  if (zenodo.mode === "own" && !zenodo.ownerUserId)
    throw new Error("Connect your Zenodo account first.");
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
  if (zenodo.mode !== "off" && zenodo.mode !== "own" && !secrets.zenodoToken?.trim())
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
            // Sent only when it isn't anyone, the community's own default: a community on a release from before it
            // refuses the key (its configuration is strict).
            ...(zenodo.defaultFileAccess && zenodo.defaultFileAccess !== "open" && { defaultFileAccess: zenodo.defaultFileAccess }),
            accessRight: "open",
            // Its own account deposits under the Crossref DOI, with the token Openscholar gives it before each one.
            ...(zenodo.mode === "own"
              ? { defaultIdentifierPolicy: "reuse-crossref", account: "openscholar" }
              : { defaultIdentifierPolicy: zenodo.defaultIdentifierPolicy, token: secrets.zenodoToken }),
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
