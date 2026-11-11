"use node";

import { buildPublicationConfiguration } from "../../lib/evidence-libraries/configuration/publication";
import type { CustomCrossref, PublicationSecrets, PublicationSettings } from "./publicationValidators";

const timeout = () => AbortSignal.timeout(15_000);
// zenodo.org answers 403 with an HTML page to Node fetch's default `node` User-Agent; its sandbox does not.
export const userAgent = "Openscholar (https://openscholar.ai)";

export async function verifyCrossrefCredentials(
  loginId: string,
  password: string,
  sandbox: boolean,
) {
  const url = new URL(
    "/servlet/login",
    sandbox ? "https://test.crossref.org" : "https://doi.crossref.org",
  );
  const separator = Math.max(
    loginId.lastIndexOf("/"),
    loginId.lastIndexOf(":"),
  );
  url.searchParams.set(
    "usr",
    separator > -1 ? loginId.slice(0, separator) : loginId,
  );
  url.searchParams.set("pwd", password);
  if (separator > -1)
    url.searchParams.set("role", loginId.slice(separator + 1));
  // Crossref's login servlet authenticates the deposit role, unlike its public metadata API.
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": userAgent },
    signal: timeout(),
    redirect: "error",
  });
  const data = await response.json().catch(() => null);
  if (
    !response.ok ||
    data?.authenticated !== true ||
    data?.authorised !== true
  ) {
    console.error("Publishing credential verification rejected", {
      provider: "crossref",
      operation: "login",
      sandbox,
      status: response.status,
      authenticated: data?.authenticated,
      authorised: data?.authorised,
    });
    throw new Error(
      "Crossref could not verify this login and deposit role. Check the credentials and try again.",
    );
  }
}

export async function verifyZenodoCredentials(token: string, sandbox: boolean) {
  const base = sandbox ? "https://sandbox.zenodo.org" : "https://zenodo.org";
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": userAgent,
  };
  // An empty private draft verifies deposit:write without uploading or publishing anything.
  const created = await fetch(`${base}/api/deposit/depositions`, {
    method: "POST",
    headers,
    body: "{}",
    signal: timeout(),
    redirect: "error",
  });
  if (created.status !== 201) {
    const contentType = created.headers.get("content-type") ?? "";
    const body = await created.text();
    console.error("Publishing credential verification rejected", {
      provider: "zenodo",
      operation: "create-draft",
      sandbox,
      status: created.status,
      contentType,
      response: body.slice(0, 500),
    });
    if (created.status === 429)
      throw new Error(
        "Zenodo is rate limiting requests. Try again later. Nothing was saved.",
      );
    if (contentType.includes("text/html"))
      throw new Error(
        "Zenodo blocked the verification request. Try again later. Nothing was saved.",
      );
    throw new Error(
      "Zenodo could not create a draft. Check the token has deposit:write permission.",
    );
  }
  const draft = await created.json();
  if (!Number.isSafeInteger(draft.id) || draft.id < 1)
    throw new Error("Zenodo returned an invalid draft response. Try again.");
  const url = `${base}/api/deposit/depositions/${draft.id}`;
  try {
    // Edit requires deposit:actions. A new draft cannot enter the published-record edit
    // state, so authorized requests return 400. No publish request is ever made.
    const action = await fetch(`${url}/actions/edit`, {
      method: "POST",
      headers,
      signal: timeout(),
      redirect: "error",
    });
    const data = await action.json().catch(() => null);
    if (
      !(
        action.status === 201 ||
        (action.status === 400 && data?.status === 400)
      )
    )
      throw new Error(
        "Zenodo could not verify deposit:actions permission. Enable it on the token and try again.",
      );
  } finally {
    const removed = await fetch(url, {
      method: "DELETE",
      headers,
      signal: timeout(),
      redirect: "error",
    });
    if (removed.status !== 204)
      throw new Error(
        `Zenodo could not remove verification draft ${draft.id}. Remove it in Zenodo and try again.`,
      );
  }
}

function sandboxValue(name: string) {
  const value = process.env[`EL_${name}`]?.trim();
  if (!value)
    throw new Error(
      "The Openscholar sandbox is not configured for this provider yet.",
    );
  return value;
}

/**
 * The registrar settings and credentials a form asks to save, as they are kept, once Zenodo and Crossref have both
 * accepted them: a community's (./publicationProviderActions.ts) or Openscholar Reports' own
 * (../reports/publicationActions.ts). A sandbox account is the platform's. A custom one keeps the secret it had
 * when none is typed. Throws, saving nothing, when a provider refuses.
 */
/** The own accounts kept so far: as stored, or, from before they were kept apart, the ones in use if they were custom. */
export type KeptCustom = { crossref?: CustomCrossref; credentials: PublicationSecrets };
const CUSTOM_CROSSREF = ["prefix", "depositorName", "email", "registrant"] as const;

export async function verifiedPublication(
  asked: { settings: PublicationSettings; credentials: PublicationSecrets },
  kept: { settings?: PublicationSettings | null; credentials: PublicationSecrets; custom?: KeptCustom },
  { namespace, crossrefAlone = false }: { /** The DOI namespace when none is typed. */ namespace: string; crossrefAlone?: boolean },
): Promise<{ settings: PublicationSettings; credentials: PublicationSecrets; custom: KeptCustom }> {
  const settings = structuredClone(asked.settings);
  for (const key of [
    "prefix",
    "suffixNamespace",
    "depositorName",
    "email",
    "registrant",
  ] as const)
    settings.crossref[key] = settings.crossref[key].trim();
  settings.zenodo.license = settings.zenodo.license.trim().toLowerCase();
  settings.crossref.suffixNamespace ||= namespace;
  // The own accounts stay kept through a spell on the sandbox: switching back takes them up again, and anything typed
  // replaces them.
  const before: KeptCustom = kept.custom ?? {
    ...(kept.settings?.crossref.mode === "custom" && { crossref: Object.fromEntries(CUSTOM_CROSSREF.map((key) => [key, kept.settings!.crossref[key]])) as CustomCrossref }),
    credentials: {
      ...(kept.settings?.zenodo.mode === "custom" && { zenodoToken: kept.credentials.zenodoToken }),
      ...(kept.settings?.crossref.mode === "custom" && { crossrefLoginId: kept.credentials.crossrefLoginId, crossrefPassword: kept.credentials.crossrefPassword }),
    },
  };
  const custom: KeptCustom = { ...(before.crossref && { crossref: before.crossref }), credentials: { ...before.credentials } };
  const credentials: PublicationSecrets = {};
  if (settings.zenodo.mode === "sandbox")
    credentials.zenodoToken = sandboxValue("ZENODO_SANDBOX_TOKEN");
  if (settings.zenodo.mode === "custom")
    custom.credentials.zenodoToken = credentials.zenodoToken =
      asked.credentials.zenodoToken?.trim() || before.credentials.zenodoToken;
  if (settings.crossref.mode === "sandbox") {
    credentials.crossrefLoginId = sandboxValue("CROSSREF_SANDBOX_LOGIN_ID");
    credentials.crossrefPassword = sandboxValue("CROSSREF_SANDBOX_PASSWORD");
    settings.crossref.prefix = sandboxValue("CROSSREF_SANDBOX_PREFIX");
    settings.crossref.depositorName = sandboxValue(
      "CROSSREF_SANDBOX_DEPOSITOR_NAME",
    );
    settings.crossref.email = sandboxValue("CROSSREF_SANDBOX_EMAIL");
    settings.crossref.registrant = sandboxValue("CROSSREF_SANDBOX_REGISTRANT");
  }
  if (settings.crossref.mode === "custom") {
    for (const key of CUSTOM_CROSSREF) settings.crossref[key] ||= before.crossref?.[key] ?? "";
    custom.crossref = Object.fromEntries(CUSTOM_CROSSREF.map((key) => [key, settings.crossref[key]])) as CustomCrossref;
    custom.credentials.crossrefLoginId = credentials.crossrefLoginId =
      asked.credentials.crossrefLoginId?.trim() || before.credentials.crossrefLoginId;
    custom.credentials.crossrefPassword = credentials.crossrefPassword =
      asked.credentials.crossrefPassword || before.credentials.crossrefPassword;
  }
  // Switching a registrar off forgets its own account too: off is how an admin removes stored credentials.
  if (settings.zenodo.mode === "off") delete custom.credentials.zenodoToken;
  if (settings.crossref.mode === "off") {
    delete custom.credentials.crossrefLoginId;
    delete custom.credentials.crossrefPassword;
    delete custom.crossref;
  }
  buildPublicationConfiguration(settings, credentials, { crossrefAlone });
  if (settings.zenodo.mode !== "off")
    await verifyZenodoCredentials(
      credentials.zenodoToken!,
      settings.zenodo.mode === "sandbox",
    );
  if (settings.crossref.mode !== "off")
    await verifyCrossrefCredentials(
      credentials.crossrefLoginId!,
      credentials.crossrefPassword!,
      settings.crossref.mode === "sandbox",
    );
  return { settings, credentials, custom };
}

/** What a refused save tells the form: the provider's own words, or that it took too long. */
export function publicationRefusal(error: unknown) {
  if (error instanceof Error && error.name === "TimeoutError")
    return "The provider took too long to respond. Nothing was saved. Try again.";
  return error instanceof Error
    ? error.message
    : "Credentials could not be verified. Nothing was saved.";
}
