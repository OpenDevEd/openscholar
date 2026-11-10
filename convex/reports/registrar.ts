"use node";

// Registers a live report with Crossref and Zenodo, through the package new-el's publication worker deposits a
// community's records with (@opendeved/doi-sync-core), so both make the same deposits. A report goes to its
// registrars in the order its route fixed when its DOI was reserved, and each answer is kept as it comes
// (./registration.ts). Every attempt is logged with what the registrar said, since it is the only record of a refusal.
import { v } from "convex/values";
import { CrossrefApiClient, ProviderHttpError, ZenodoApiClient, mapCrossrefRecord } from "@opendeved/doi-sync-core";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import type { PublicationSecrets } from "../evidenceLibraries/publicationValidators";
import { userAgent } from "../evidenceLibraries/publicationCredentialVerification";
import { decrypt } from "../lib/crypto";
import { requireAppUrl } from "../lib/env";
import { registrationRecord } from "../../lib/reports/registration-record";

/** A registrar that couldn't be reached, or answered that it is busy: worth trying again. Anything else is a refusal. */
const unreached = (error: unknown) => (error instanceof ProviderHttpError ? error.retryable : error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError"));

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
      for (const provider of job.waiting) {
        try {
          // Inside the attempt, so settings that can't be read are a refusal a reviewer sees, never a report left queued.
          const key = process.env.ENCRYPTION_KEY;
          secrets = job.encryptedCredentials && key ? JSON.parse(decrypt(job.encryptedCredentials, key)) : {};
          const { crossref, zenodo } = job.publication;
          const record = registrationRecord(job, job.metadata, job.series, zenodo.license, requireAppUrl());
          if (provider === "crossref") {
            if (crossref.mode === "off" || !secrets.crossrefLoginId || !secrets.crossrefPassword) throw new Error("Crossref isn't connected in the publishing settings.");
            const mapped = mapCrossrefRecord(record, job.doi);
            if (!mapped.ok) throw new Error(`Crossref can't take this record: ${mapped.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
            const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 17);
            const environment = crossref.mode === "sandbox" ? ("test" as const) : ("production" as const);
            const client = new CrossrefApiClient();
            // A deposit Crossref already took is only looked for, never sent twice.
            const seen = async () => (await client.verifyPublication({ environment, emailAddress: crossref.email, record: mapped.record })).status === "matched";
            let registered = false;
            let taken = job.depositSent;
            if (!taken) {
              const outcome = await client.submitPublication({
                environment,
                loginId: secrets.crossrefLoginId,
                password: secrets.crossrefPassword,
                depositorName: crossref.depositorName,
                emailAddress: crossref.email,
                registrant: crossref.registrant,
                batchId: `openscholar-reports-${job.key}-${stamp}`,
                // Crossref keeps the deposit with the latest timestamp, so a correction replaces what it held.
                timestamp: stamp,
                filename: `openscholar-reports-${job.key}-${stamp}.xml`,
                record: mapped.record,
                // Kept the moment Crossref has the file, so nothing that fails after this sends it again.
                onSubmitted: async () => void (await ctx.runMutation(internal.reports.registration.noted, { reportId, rev, depositSent: true })),
              });
              console.info(JSON.stringify({ event: "report-crossref-deposit", reportId, key: job.key, status: outcome.status, diagnostic: "diagnostic" in outcome ? outcome.diagnostic : null }));
              if (outcome.status === "failed") throw new Error(`Crossref refused the deposit: ${outcome.diagnostic.failureCount} of ${outcome.diagnostic.recordCount} records failed (${outcome.diagnostic.batchStatus ?? outcome.diagnostic.status}).`);
              registered = outcome.status === "succeeded";
              taken = true;
            }
            // Its sandbox stops at "taken", and production may not show the record at once: it is looked for, now and on later tries.
            registered ||= await seen();
            console.info(JSON.stringify({ event: "report-crossref-verify", reportId, key: job.key, registered }));
            if (!(await settle(provider, registered ? { outcome: "done" } : { outcome: "unreached", error: "Crossref took the deposit and doesn't show the record yet." }))) return null;
          } else {
            if (zenodo.mode === "off" || !secrets.zenodoToken) throw new Error("Zenodo isn't connected in the publishing settings.");
            const token = secrets.zenodoToken;
            const client = new ZenodoApiClient({
              endpoint: zenodo.mode === "sandbox" ? "https://sandbox.zenodo.org" : "https://zenodo.org",
              // zenodo.org answers 403 to an unknown User-Agent, so every call says who is asking.
              fetch: (url, init) => fetch(url, { ...init, headers: { ...init.headers, "User-Agent": userAgent } }),
            });
            // Reusing the Crossref DOI, Zenodo archives the file under it; otherwise it gives the copy a DOI of its own.
            const doiPolicy = job.registration.crossref && job.registration.policy === "reuse-crossref" ? ("external-crossref" as const) : ("dual" as const);
            const { fields: _fields, landingUrl, doi, ...metadata } = record;
            const shared = { token, doiPolicy, metadata: { ...metadata, ...(doiPolicy === "external-crossref" && { doi }) }, resourceUrl: landingUrl };
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
