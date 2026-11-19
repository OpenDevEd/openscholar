"use node";

// Registers a live report with Crossref and Zenodo, through the package new-el's publication worker deposits a
// community's records with (@opendeved/doi-sync-core), so both make the same deposits. A report goes to its
// registrars in the order its route fixed when its DOI was reserved, and each answer is kept as it comes
// (./registration.ts). Every attempt is logged with what the registrar said, since it is the only record of a refusal.
import { v } from "convex/values";
import { CrossrefApiClient, ProviderHttpError, ZenodoApiClient, mapCrossrefRecord, type CrossrefDiagnosticResult } from "@opendeved/doi-sync-core";
import { internal } from "../_generated/api";
import { zenodoAccessToken } from "../zenodo/connectionActions";
import { internalAction } from "../_generated/server";
import type { PublicationSecrets } from "../evidenceLibraries/publicationValidators";
import { userAgent } from "../evidenceLibraries/publicationCredentialVerification";
import { decrypt } from "../lib/crypto";
import { requireAppUrl } from "../lib/env";
import { openAlexFetch } from "../../lib/openalex/fetch";
import { openAlexUrl } from "../../lib/openalex/request-url";
import type { Metadata } from "../../lib/reports/report";
import { openAlexKey, registrationRecord, rorKey, zenodoRecord, type RegistryIds } from "../../lib/reports/registration-record";
import { fundrefOf } from "../../lib/people/identifiers";

/** OpenAlex couldn't say who a report's funders and institutions are in the Funder Registry and ROR: worth trying again, like a registrar that couldn't be reached. */
class IdsUnread extends Error {}

/** A registrar that couldn't be reached, or answered that it is busy: worth trying again. Anything else is a refusal. */
const unreached = (error: unknown) =>
  error instanceof IdsUnread || (error instanceof ProviderHttpError ? error.retryable : error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError"));

/** Crossref's own words for a refused deposit, or its counts when it gave none. */
const said = (diagnostic: CrossrefDiagnosticResult) =>
  diagnostic.failures?.join(" ") || `${diagnostic.failureCount} of ${diagnostic.recordCount} records failed (${diagnostic.batchStatus ?? diagnostic.status}).`;

/**
 * What OpenAlex knows of a report's funders and institutions: each funder's Funder Registry DOI and ROR, and each
 * institution's ROR. One request each, as a report holds at most 50 funders and its authors' institutions are few.
 */
async function registryIds(m: Metadata): Promise<RegistryIds> {
  const ask = async (entity: "funders" | "institutions", ids: string[]) => {
    if (!ids.length) return [];
    const results: Array<{ id: string; ids?: { doi?: string | null; ror?: string | null } }> = [];
    for (let at = 0; at < ids.length; at += 50) {
      const response = await openAlexFetch(openAlexUrl(entity, { filter: `openalex:${ids.slice(at, at + 50).join("|")}`, select: "id,ids", "per-page": "50" }), { timeoutMs: 12_000 });
      if (!response.ok) throw new IdsUnread(`OpenAlex answered ${response.status} when asked for the report's ${entity}.`);
      results.push(...((await response.json()) as { results: typeof results }).results);
    }
    return results;
  };
  const unique = (ids: Array<string | null>) => [...new Set(ids.flatMap((id) => (id ? [openAlexKey(id)] : [])))];
  const [funders, institutions] = await Promise.all([
    ask("funders", unique(m.funding.map((f) => f.funder.id))),
    ask("institutions", unique(m.authors.flatMap((author) => author.affiliations.map((affiliation) => affiliation.id)))),
  ]);
  // A funder only ROR knows: its Funder Registry ID, which ROR lists as "fundref" where Crossref has the funder.
  const onRor = [...new Set(m.funding.flatMap((f) => (!f.funder.id && f.funder.ror ? (rorKey(f.funder.ror) ?? []) : [])))];
  const rorFunders = Object.fromEntries((await Promise.all(onRor.map(async (ror) => [ror, await fundrefOf(ror).catch((error: unknown) => { throw new IdsUnread(`ROR couldn't say whether funder ${ror} is in the Funder Registry: ${String(error).slice(0, 200)}`); })] as const))).flatMap(([ror, fundref]) => (fundref ? [[ror, `10.13039/${fundref}`]] : [])));
  return {
    rorFunders,
    funders: Object.fromEntries(funders.map((funder) => [openAlexKey(funder.id), { ...(funder.ids?.doi && { doi: funder.ids.doi }), ...(funder.ids?.ror && { ror: funder.ids.ror }) }])),
    institutions: Object.fromEntries(institutions.flatMap((institution) => (institution.ids?.ror ? [[openAlexKey(institution.id), institution.ids.ror]] : []))),
  };
}

export const register = internalAction({
  args: { reportId: v.id("reports"), rev: v.number() },
  returns: v.null(),
  handler: async (ctx, { reportId, rev }) => {
    const job = await ctx.runMutation(internal.reports.registration.begin, { reportId, rev });
    if (!job) return null;
    let secrets: PublicationSecrets = {};
    // What a registrar said, for the log and for a reviewer, with nothing of the accounts in it: a registrar's
    // answer can repeat what it was sent.
    const words = (error: unknown) => {
      const said = error instanceof ProviderHttpError ? `${error.provider} answered ${error.status}: ${error.body.slice(0, 300)}` : String(error);
      return Object.values(secrets).reduce((text, secret) => (secret ? text.replaceAll(secret, "[hidden]") : text), said).slice(0, 500);
    };
    const settle = (provider: "crossref" | "zenodo", answer: { outcome: "done" | "refused" | "unreached"; error?: string; zenodoRecordId?: string; zenodoDoi?: string }) =>
      ctx.runMutation(internal.reports.registration.settle, { reportId, rev, provider, ...answer });
    try {
      // A report Zenodo already holds is changed there first: a restriction on its file never waits on Crossref.
      for (const provider of job.zenodoRecordId ? [...job.waiting].sort((a, b) => (a === "zenodo" ? -1 : b === "zenodo" ? 1 : 0)) : job.waiting) {
        try {
          // Inside the attempt, so settings that can't be read are a refusal a reviewer sees, never a report left queued.
          const key = process.env.ENCRYPTION_KEY;
          secrets = job.encryptedCredentials && key ? JSON.parse(decrypt(job.encryptedCredentials, key)) : {};
          const { crossref, zenodo } = job.publication;
          const record = registrationRecord({ ...job, pages: job.pdf?.pages, hasPdf: job.pdf !== null, fileAccess: job.fileAccess }, job.metadata, job.series, requireAppUrl(), await registryIds(job.metadata));
          if (provider === "crossref") {
            if (crossref.mode === "off" || !secrets.crossrefLoginId || !secrets.crossrefPassword) throw new Error("Crossref isn't connected in the publishing settings.");
            const mapped = mapCrossrefRecord(record, job.doi);
            if (!mapped.ok) throw new Error(`Crossref can't take this record: ${mapped.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
            const environment = crossref.mode === "sandbox" ? ("test" as const) : ("production" as const);
            const [loginId, password] = [secrets.crossrefLoginId, secrets.crossrefPassword];
            const client = new CrossrefApiClient();
            // A deposit Crossref already took is only looked for, never sent twice.
            const seen = async () => (await client.verifyPublication({ environment, emailAddress: crossref.email, record: mapped.record })).status === "matched";
            const deposit = (relation?: "delete-all") => {
              const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 17);
              const name = `openscholar-reports-${job.key}-${stamp}${relation ? "-clear" : ""}`;
              return {
                environment,
                loginId,
                password,
                depositorName: crossref.depositorName,
                emailAddress: crossref.email,
                registrant: crossref.registrant,
                batchId: name,
                // Crossref keeps the deposit with the latest timestamp, so a correction replaces what it held.
                timestamp: stamp,
                filename: `${name}.xml`,
                record: mapped.record,
                ...(relation && { relation }),
              };
            };
            let registered = false;
            let taken = job.depositSent;
            if (!taken && mapped.record.relations?.length) {
              // Crossref can't replace a record's links by a redeposit: the ones it holds go first, in a deposit of their own.
              // Asked once, since a corrected record never matches the one Crossref holds until it is sent.
              const held = await new CrossrefApiClient({ poll: { maxAttempts: 1, delayMs: 0 } }).verifyPublication({ environment, emailAddress: crossref.email, record: mapped.record });
              if (held.record?.relations?.length) {
                const cleared = await client.submitPublication(deposit("delete-all"));
                console.info(JSON.stringify({ event: "report-crossref-clear", reportId, key: job.key, held: held.record.relations.length, status: cleared.status }));
                if (cleared.status === "failed") throw new Error(`Crossref refused clearing the report's earlier links: ${said(cleared.diagnostic)}`);
                // Until Crossref shows them gone, the links to send wait: the next try looks again.
                if (cleared.status !== "succeeded") {
                  if (!(await settle(provider, { outcome: "unreached", error: "Crossref is clearing the report's earlier links before the new ones go in." }))) return null;
                  continue;
                }
              }
            }
            if (!taken) {
              const outcome = await client.submitPublication({
                ...deposit(),
                // Kept the moment Crossref has the file, so nothing that fails after this sends it again.
                onSubmitted: async () => void (await ctx.runMutation(internal.reports.registration.noted, { reportId, rev, depositSent: true })),
              });
              console.info(JSON.stringify({ event: "report-crossref-deposit", reportId, key: job.key, status: outcome.status, diagnostic: "diagnostic" in outcome ? outcome.diagnostic : null }));
              if (outcome.status === "failed") throw new Error(`Crossref refused the deposit: ${said(outcome.diagnostic)}`);
              registered = outcome.status === "succeeded";
              taken = true;
            }
            // Its sandbox stops at "taken", and production may not show the record at once: it is looked for, now and on later tries.
            registered ||= await seen();
            console.info(JSON.stringify({ event: "report-crossref-verify", reportId, key: job.key, registered }));
            if (!(await settle(provider, registered ? { outcome: "done" } : { outcome: "unreached", error: "Crossref took the deposit and doesn't show the record yet." }))) return null;
          } else {
            // In its author's own Zenodo account (#1237), under their name: always zenodo.org, as sandbox.zenodo.org has
            // accounts of its own. A connection Zenodo no longer accepts refuses the report, which waits for them.
            const own = job.archiveOwnerId !== undefined;
            if (!own && (zenodo.mode === "off" || !secrets.zenodoToken)) throw new Error("Zenodo isn't connected in the publishing settings.");
            const token = own ? await zenodoAccessToken(ctx, job.archiveOwnerId!) : secrets.zenodoToken!;
            const endpoint = own || zenodo.mode !== "sandbox" ? "https://zenodo.org" : "https://sandbox.zenodo.org";
            // A deployment registering in the sandboxes (shared dev) never publishes a real record with a test DOI in
            // someone's own account: it leaves a draft there, which they may discard.
            const draftOnly = own && zenodo.mode === "sandbox";
            const client = new ZenodoApiClient({
              endpoint,
              // zenodo.org answers 403 to an unknown User-Agent, so every call says who is asking.
              fetch: (url, init) => fetch(url, { ...init, headers: { ...init.headers, "User-Agent": userAgent } }),
            });
            // Reusing the Crossref DOI, Zenodo archives the file under it; otherwise it gives the copy a DOI of its own.
            const doiPolicy = own || (job.registration.crossref && job.registration.policy === "reuse-crossref") ? ("external-crossref" as const) : ("dual" as const);
            const { landingUrl, doi, ...metadata } = zenodoRecord(record, job.metadata);
            const shared = { token, doiPolicy, metadata: { ...metadata, ...(doiPolicy === "external-crossref" && { doi }) }, resourceUrl: landingUrl };
            if (draftOnly) {
              const blob = job.pdf && (await ctx.storage.get(job.pdf.file));
              if (!blob) throw new Error("The report's PDF is missing, so there is nothing to archive.");
              // The draft already there takes the report as it now stands (its file and details), one gone is made again,
              // and a new draft's id is kept the moment Zenodo gives it, so a try that fails after never makes another.
              const draft = await client.prepareCreateRecord({
                ...shared,
                ...(job.zenodoDraftId && { draftDepositionId: job.zenodoDraftId }),
                files: [{ key: job.key, filename: `${job.key}.pdf`, contentType: "application/pdf", bytes: new Uint8Array(await blob.arrayBuffer()) }],
                onPreparedDraft: async ({ depositionId }) => {
                  await ctx.runMutation(internal.reports.registration.noted, { reportId, rev, zenodoDraftId: depositionId });
                },
              });
              console.info(JSON.stringify({ event: "report-zenodo-own-draft", reportId, key: job.key, draft: draft.depositionId }));
              if (!(await settle(provider, { outcome: "done" }))) return null;
              continue;
            }
            // A record published by a try whose answer never arrived is found under the report's DOI, not made again.
            const found = job.zenodoRecordId ?? (doiPolicy === "external-crossref" ? await client.findRecordByDoi({ token, doi }).then((looked) => (looked.status === "found" ? looked.record.identifiers.latestRecordId : undefined)) : undefined);
            const identifiers = found
              ? await client.updateRecordMetadata({ ...shared, latestRecordId: found })
              : await (async () => {
                  const blob = job.pdf && (await ctx.storage.get(job.pdf.file));
                  if (!blob) throw new Error("The report's PDF is missing, so there is nothing to archive.");
                  return client.createRecord({
                    ...shared,
                    ...(job.zenodoDraftId && { draftDepositionId: job.zenodoDraftId }),
                    files: [{ key: job.key, filename: `${job.key}.pdf`, contentType: "application/pdf", bytes: new Uint8Array(await blob.arrayBuffer()) }],
                    // Kept the moment Zenodo has a draft, so a later failure carries on from it and never makes another.
                    onPreparedDraft: async (draft) => void (await ctx.runMutation(internal.reports.registration.noted, { reportId, rev, zenodoDraftId: draft.depositionId })),
                  });
                })();
            console.info(JSON.stringify({ event: "report-zenodo-archive", reportId, key: job.key, record: identifiers.latestRecordId, doi: identifiers.versionDoi ?? null }));
            // Who may get the file, as Zenodo now shows it: a write it answered without taking is tried again, never
            // counted done while a file meant to be private is still public there.
            const wanted = record.fileAccess ? "restricted" : "public";
            const shown = await fetch(`${endpoint}/api/records/${identifiers.latestRecordId}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.inveniordm.v1+json", "User-Agent": userAgent } })
              .then(async (answer) => (answer.ok ? ((await answer.json()) as { access?: { files?: string } }).access?.files : undefined))
              .catch(() => undefined);
            if (shown !== wanted) {
              console.error(JSON.stringify({ event: "report-zenodo-access-mismatch", reportId, key: job.key, record: identifiers.latestRecordId, wanted, shown: shown ?? null }));
              await settle(provider, { outcome: "unreached", error: `Zenodo shows the file as ${shown ?? "unknown"}, not ${wanted}.` });
              return null;
            }
            if (!(await settle(provider, { outcome: "done", zenodoRecordId: identifiers.latestRecordId, ...(identifiers.versionDoi && { zenodoDoi: identifiers.versionDoi }) }))) return null;
          }
        } catch (error) {
          console.error(JSON.stringify({ event: "report-registration-failed", reportId, key: job.key, provider, error: words(error) }));
          await settle(provider, { outcome: unreached(error) ? "unreached" : "refused", error: words(error) });
          // The registrar after this one waits for it.
          return null;
        }
      }
    } finally {
      await ctx.runMutation(internal.reports.registration.end, { reportId });
    }
    return null;
  },
});
