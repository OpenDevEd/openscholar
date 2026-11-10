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
const words = (error: unknown) => (error instanceof ProviderHttpError ? `${error.provider} answered ${error.status}: ${error.body.slice(0, 300)}` : String(error)).slice(0, 500);

export const register = internalAction({
  args: { reportId: v.id("reports") },
  returns: v.null(),
  handler: async (ctx, { reportId }) => {
    const job = await ctx.runQuery(internal.reports.registration.job, { reportId });
    if (!job) return null;
    const key = process.env.ENCRYPTION_KEY;
    const secrets: PublicationSecrets = job.encryptedCredentials && key ? JSON.parse(decrypt(job.encryptedCredentials, key)) : {};
    const { crossref, zenodo } = job.publication;
    const record = registrationRecord(job, job.metadata, job.series, zenodo.license, requireAppUrl());
    for (const provider of job.waiting) {
      try {
        if (provider === "crossref") {
          if (crossref.mode === "off" || !secrets.crossrefLoginId || !secrets.crossrefPassword) throw new Error("Crossref isn't connected in the publishing settings.");
          const mapped = mapCrossrefRecord(record, job.doi);
          if (!mapped.ok) throw new Error(`Crossref can't take this record: ${mapped.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
          const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 17);
          const environment = crossref.mode === "sandbox" ? ("test" as const) : ("production" as const);
          const client = new CrossrefApiClient();
          // A deposit Crossref already took is only looked for, never sent twice.
          const seen = async () => (await client.verifyPublication({ environment, emailAddress: crossref.email, record: mapped.record })).status === "matched";
          if (job.depositSent) {
            const there = await seen();
            console.info(JSON.stringify({ event: "report-crossref-verify", reportId, key: job.key, there }));
            await ctx.runMutation(internal.reports.registration.settle, there ? { reportId, provider, outcome: "done" } : { reportId, provider, outcome: "unreached", error: "Crossref took the deposit and doesn't show the record yet.", sent: true });
            if (!there) return null;
            continue;
          }
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
          });
          console.info(JSON.stringify({ event: "report-crossref-deposit", reportId, key: job.key, status: outcome.status, diagnostic: "diagnostic" in outcome ? outcome.diagnostic : null }));
          if (outcome.status === "failed") throw new Error(`Crossref refused the deposit: ${outcome.diagnostic.failureCount} of ${outcome.diagnostic.recordCount} records failed (${outcome.diagnostic.batchStatus ?? outcome.diagnostic.status}).`);
          // Crossref answered that the batch went in without failures: its sandbox stops there, and production may
          // not show the record at once. Either way the record is looked for, now and again later, and never re-sent.
          const taken = outcome.status === "succeeded" || (outcome.diagnostic !== undefined && outcome.diagnostic.failureCount === 0 && (outcome.diagnostic.successCount ?? 0) > 0);
          const registered = outcome.status === "succeeded" || (taken && (await seen()));
          await ctx.runMutation(
            internal.reports.registration.settle,
            registered ? { reportId, provider, outcome: "done" } : { reportId, provider, outcome: "unreached", error: taken ? "Crossref took the deposit and doesn't show the record yet." : "Crossref hasn't processed the deposit yet.", ...(taken && { sent: true }) },
          );
          if (!registered) return null;
        } else {
          if (zenodo.mode === "off" || !secrets.zenodoToken) throw new Error("Zenodo isn't connected in the publishing settings.");
          const client = new ZenodoApiClient({
            endpoint: zenodo.mode === "sandbox" ? "https://sandbox.zenodo.org" : "https://zenodo.org",
            // zenodo.org answers 403 to an unknown User-Agent, so every call says who is asking.
            fetch: (url, init) => fetch(url, { ...init, headers: { ...init.headers, "User-Agent": userAgent } }),
          });
          // Reusing the Crossref DOI, Zenodo archives the file under it; otherwise it gives the copy a DOI of its own.
          const doiPolicy = job.registration.crossref && job.registration.policy === "reuse-crossref" ? ("external-crossref" as const) : ("dual" as const);
          const { fields: _fields, landingUrl, doi, ...metadata } = record;
          const shared = { token: secrets.zenodoToken, doiPolicy, metadata: { ...metadata, ...(doiPolicy === "external-crossref" && { doi }) }, resourceUrl: landingUrl };
          let made: string | undefined;
          const identifiers = job.zenodoRecordId
            ? await client.updateRecordMetadata({ ...shared, latestRecordId: job.zenodoRecordId })
            : await (async () => {
                const blob = job.pdf && (await ctx.storage.get(job.pdf.file));
                if (!blob || !job.pdf) throw new Error("The report's PDF is missing, so there is nothing to archive.");
                return client.createRecord({
                  ...shared,
                  files: [{ key: job.key, filename: `${job.key}.pdf`, contentType: "application/pdf", bytes: new Uint8Array(await blob.arrayBuffer()) }],
                  onPreparedDraft: async (draft) => void (made = String((draft as { depositionId?: unknown }).depositionId ?? "")),
                });
              })();
          console.info(JSON.stringify({ event: "report-zenodo-archive", reportId, key: job.key, record: identifiers.latestRecordId, doi: identifiers.versionDoi ?? null, draft: made ?? null }));
          await ctx.runMutation(internal.reports.registration.settle, { reportId, provider, outcome: "done", zenodoRecordId: identifiers.latestRecordId, ...(identifiers.versionDoi && { zenodoDoi: identifiers.versionDoi }) });
        }
      } catch (error) {
        console.error(JSON.stringify({ event: "report-registration-failed", reportId, key: job.key, provider, error: words(error) }));
        await ctx.runMutation(internal.reports.registration.settle, { reportId, provider, outcome: unreached(error) ? "unreached" : "refused", error: words(error) });
        // The registrar after this one waits for it.
        return null;
      }
    }
    return null;
  },
});
