"use node";

/**
 * What the Domain section's buttons do.
 *
 * Every step is the owner's: adding a domain, checking it, and removing it.
 * Nothing runs in the background and nothing is written unless the step it
 * belongs to succeeded. A step that could not run answers `check-failed`,
 * the same rule the platform address check follows.
 */

import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { readServedHosts } from "./addressActions";
import {
  createPlatformCloudflareSaasClient,
  type CertificateState,
} from "./cloudflareSaasClient";
import { CoolifyClientError, createCoolifyClient } from "./coolifyClient";
import {
  caaScanNames,
  classifyCaaChain,
  classifyTarget as classifyTargetReading,
  classifyToken,
  DnsLookupError,
  isPublicInternetAddress,
  isReservedPlatformHost,
  lookupHost,
  normaliseDomainHost,
  readAgreedAnswer,
} from "./dnsClient";
import {
  readCustomDomainTarget,
  readReservedDomainSuffixes,
  verificationRecordName,
  verificationRecordValue,
} from "./domainConfig";
import {
  nextDomainStep,
  readDomainAnswer,
  readDomainRecords,
  type DomainFailure,
  type DomainOutcome,
} from "./domainGates";

/** A step that could not run. Nothing is written and no state moves. */
class DomainCheckUnavailable extends Error {
  constructor() {
    super("The domain could not be checked");
    this.name = "DomainCheckUnavailable";
  }
}
import { probeEvidenceLibraryAddress } from "./readinessClient";
import {
  evidenceLibraryCertificateStateValidator,
  evidenceLibraryDomainFailureValidator,
  evidenceLibraryDomainStateValidator,
} from "./validators";

type AddDomainResult =
  | { status: "added"; domainId: Id<"evidenceLibraryDomains"> }
  | {
      status: "refused";
      reason:
        | "invalid"
        | "platform-host"
        | "host-taken"
        | "too-many"
        | "not-set-up"
        | "check-failed";
    };

type CheckDomainResult =
  | {
      status: "checked";
      state: "added" | "pointing" | "verified" | "active" | "failed";
      failure?: DomainFailure;
      certificateState?: CertificateState;
    }
  // The check could not run, or another one is already running. Neither
  // moves the domain's state.
  | { status: "check-failed" }
  | { status: "busy" };

const checkedValidator = v.union(
  v.object({
    status: v.literal("checked"),
    state: evidenceLibraryDomainStateValidator,
    failure: v.optional(evidenceLibraryDomainFailureValidator),
    certificateState: v.optional(evidenceLibraryCertificateStateValidator),
  }),
  v.object({ status: v.literal("check-failed") }),
  v.object({ status: v.literal("busy") }),
);

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function coolify() {
  return createCoolifyClient({
    origin: requireEnvironment("EL_COOLIFY_URL"),
    token: requireEnvironment("EL_COOLIFY_TOKEN"),
  });
}

/**
 * Adds one custom domain. The host has to be free everywhere we can look
 * before a row exists at all: not held by another library, and not already
 * served by anything on our own servers.
 */
export const addDomain = action({
  args: { libraryId: v.id("evidenceLibraries"), host: v.string() },
  returns: v.union(
    v.object({
      status: v.literal("added"),
      domainId: v.id("evidenceLibraryDomains"),
    }),
    v.object({
      status: v.literal("refused"),
      reason: v.union(
        v.literal("invalid"),
        v.literal("platform-host"),
        v.literal("host-taken"),
        v.literal("too-many"),
        v.literal("not-set-up"),
        v.literal("check-failed"),
      ),
    }),
  ),
  handler: async (ctx, args): Promise<AddDomainResult> => {
    if (!createPlatformCloudflareSaasClient()) {
      return { status: "refused" as const, reason: "not-set-up" as const };
    }
    let host: string;
    try {
      host = normaliseDomainHost(args.host);
    } catch {
      return { status: "refused" as const, reason: "invalid" as const };
    }
    const context = await ctx.runQuery(
      internal.evidenceLibraries.domains.readDomainContext,
      { libraryId: args.libraryId },
    );
    const platformHost = new URL(context.platformAddress).hostname;
    // A name we already serve is not a custom domain; it is one of ours.
    if (
      isReservedPlatformHost(host, [
        ...readReservedDomainSuffixes(),
        platformHost,
      ])
    ) {
      return { status: "refused" as const, reason: "platform-host" as const };
    }
    let served: Set<string>;
    try {
      served = await readServedHosts(ctx);
    } catch {
      return { status: "refused" as const, reason: "check-failed" as const };
    }
    if (served.has(host)) {
      return { status: "refused" as const, reason: "host-taken" as const };
    }
    const claimed = await ctx.runMutation(
      internal.evidenceLibraries.domains.claimDomainHost,
      { libraryId: args.libraryId, host },
    );
    if (claimed.status !== "added") {
      return { status: "refused" as const, reason: claimed.status };
    }
    return { status: "added" as const, domainId: claimed.domainId };
  },
});

/** The addresses our CNAME target answers with, as both resolvers see them. */
async function readTargetAddresses(target: string): Promise<string[]> {
  return readAgreedAnswer(
    await lookupHost(fetch, target, "A"),
    (answer) => answer.addresses.slice().sort().join(","),
  )
    .split(",")
    .filter(Boolean);
}

/**
 * The address record still reaches us, and every address behind it is on the
 * public internet.
 *
 * This runs again immediately before every request the platform makes to a
 * custom domain. The records belong to the owner, who can repoint them at any
 * moment: without this, a verified domain could be aimed at an address inside
 * our own network and the platform would fetch it.
 */
async function requireSafeProbeTarget(host: string): Promise<void> {
  const target = readCustomDomainTarget();
  const targetAddresses = await readTargetAddresses(target);
  const answers = await lookupHost(fetch, host, "A");
  const reading = readAgreedAnswer(answers, (answer) =>
    classifyTargetReading(answer, { target, targetAddresses }),
  );
  if (reading !== "pointing") throw new DomainCheckUnavailable();
  const addresses = answers.flatMap((answer) => answer.addresses);
  if (addresses.length === 0 || !addresses.every(isPublicInternetAddress)) {
    throw new DomainCheckUnavailable();
  }
}

/** Reads the two records the owner was asked to add. */
async function readRecordGates(
  host: string,
  token: string,
): Promise<DomainOutcome> {
  const target = readCustomDomainTarget();
  const [targetAnswers, tokenAnswers] = await Promise.all([
    lookupHost(fetch, host, "A"),
    lookupHost(fetch, verificationRecordName(host), "TXT"),
  ]);
  const targetAddresses = await readTargetAddresses(target);
  const targetReading = readAgreedAnswer(targetAnswers, (answer) =>
    classifyTargetReading(answer, { target, targetAddresses }),
  );
  const tokenReading = readAgreedAnswer(tokenAnswers, (answer) =>
    classifyToken(answer, verificationRecordValue(token)),
  );
  // The certificate rules only matter once the name reaches us.
  let caa: "ok" | "blocked" = "ok";
  if (targetReading === "pointing") {
    const chain: string[][] = [];
    for (const name of caaScanNames(host)) {
      chain.push(
        readAgreedAnswer(await lookupHost(fetch, name, "CAA"), (answer) =>
          answer.caaIssuers.slice().sort().join("\u0000"),
        ).split("\u0000"),
      );
    }
    caa = classifyCaaChain(
      chain.map((issuers) =>
        issuers.length === 1 && issuers[0] === "" ? [] : issuers,
      ),
    );
  }
  return readDomainRecords({
    target: targetReading,
    caa,
    token: tokenReading,
  });
}

/**
 * Hands a verified domain to the certificate service and the proxy, then
 * publishes the library again so the proxy rules reach the running site.
 *
 * Every step saves its receipt the moment it succeeds, so a failure halfway
 * through leaves a record of what already happened and pressing Check again
 * carries on from there rather than starting over.
 */
async function attachDomain(
  ctx: ActionCtx,
  input: {
    libraryId: Id<"evidenceLibraries">;
    domainId: Id<"evidenceLibraryDomains">;
    host: string;
    platformAddress: string;
    applicationUuid: string;
    attachedHosts: readonly string[];
    certificateHostnameId: string | null;
    attached: boolean;
  },
): Promise<DomainOutcome & { certificateState?: CertificateState }> {
  const cloudflare = createPlatformCloudflareSaasClient();
  if (!cloudflare) throw new DomainCheckUnavailable();

  // Step one: the certificate service. Its id is saved before anything else
  // is attempted, so a later failure can never orphan the hostname.
  const hostname =
    (await cloudflare.readCustomHostname(input.host)) ??
    (await cloudflare.createCustomHostname({
      host: input.host,
      // The library's own platform address answers the request, so the
      // runtime serves the certificate it already has and never asks for
      // one in the customer's name.
      originHost: new URL(input.platformAddress).hostname,
    }));
  if (input.certificateHostnameId !== hostname.hostnameId || !input.attached) {
    await ctx.runMutation(
      internal.evidenceLibraries.domains.writeDomainAttachment,
      {
        libraryId: input.libraryId,
        domainId: input.domainId,
        attached: false,
        certificateHostnameId: hostname.hostnameId,
        certificateState: hostname.certificate,
      },
    );
  }

  // Step two: the proxy. Running it again with the host already in the list
  // writes nothing, so a retry is safe.
  const wanted = [...input.attachedHosts, `https://${input.host}`].sort();
  try {
    await coolify().setCustomDomains({
      applicationUuid: input.applicationUuid,
      libraryId: input.libraryId,
      publicDomain: input.platformAddress,
      currentCustomDomains: input.attachedHosts,
      customDomains: wanted,
    });
  } catch (error) {
    if (
      error instanceof CoolifyClientError &&
      error.code === "COOLIFY_DOMAIN_TAKEN"
    ) {
      return { state: "failed", failure: "host-taken" };
    }
    throw error;
  }
  await ctx.runMutation(
    internal.evidenceLibraries.domains.writeDomainAttachment,
    {
      libraryId: input.libraryId,
      domainId: input.domainId,
      attached: true,
      certificateHostnameId: hostname.hostnameId,
      certificateState: hostname.certificate,
    },
  );

  // Step three: the deployment that puts the rules into the running site.
  // The row already says the proxy holds the host, so a failure here leaves
  // the next Check to start the deployment again.
  await ctx.runMutation(
    internal.evidenceLibraries.versions.startDomainDeployment,
    {
      libraryId: input.libraryId,
      domainId: input.domainId,
      host: input.host,
      reason: "attach",
    },
  );
  return { state: "verified", certificateState: hostname.certificate };
}

/** Asks the domain itself whether this library answers on it. */
async function readAnswerGate(input: {
  host: string;
  liveRevisionKey: string | null;
}): Promise<DomainOutcome & { certificateState?: CertificateState }> {
  const cloudflare = createPlatformCloudflareSaasClient();
  const hostname = cloudflare
    ? await cloudflare.readCustomHostname(input.host)
    : null;
  const certificate: CertificateState = hostname?.certificate ?? "pending";
  // Checked again here, right before the request: the records may have moved
  // since the domain was verified.
  await requireSafeProbeTarget(input.host);
  const address = await probeEvidenceLibraryAddress({
    targetBaseUrl: `https://${input.host}`,
  });
  const outcome = readDomainAnswer({
    address: address.state,
    liveRevision:
      address.revision !== null && address.revision === input.liveRevisionKey,
    certificate,
  });
  return { ...outcome, certificateState: certificate };
}

/**
 * One button, one step forward. Reads the records until the domain is
 * verified, then attaches it, then asks the domain itself.
 *
 * Only one check runs per domain at a time, and each one spends the owner's,
 * the library's and the domain's check budget.
 */
export const checkDomain = action({
  args: {
    libraryId: v.id("evidenceLibraries"),
    domainId: v.id("evidenceLibraryDomains"),
  },
  returns: checkedValidator,
  handler: async (ctx, args): Promise<CheckDomainResult> => {
    const claimed = await ctx.runMutation(
      internal.evidenceLibraries.domains.claimDomainCheck,
      { libraryId: args.libraryId, domainId: args.domainId },
    );
    if (claimed.status === "busy") {
      return { status: "busy" as const };
    }
    try {
      const context = await ctx.runQuery(
        internal.evidenceLibraries.domains.readDomainContext,
        { libraryId: args.libraryId, domainId: args.domainId },
      );
      const row = context.domain;
      if (!row) throw new Error("That domain is not on this library");
      const step = nextDomainStep({
        state: row.state,
        ...(row.attached ? { attachedAt: 1 } : {}),
      });

      let outcome: DomainOutcome & { certificateState?: CertificateState };
      try {
        if (step === "records") {
          outcome = await readRecordGates(row.host, row.verificationToken);
        } else if (step === "attach") {
          if (!context.applicationUuid || !context.liveRevisionKey) {
            outcome = { state: "failed", failure: "not-served" };
          } else {
            outcome = await attachDomain(ctx, {
              libraryId: args.libraryId,
              domainId: args.domainId,
              host: row.host,
              platformAddress: context.platformAddress,
              applicationUuid: context.applicationUuid,
              attachedHosts: context.attachedHosts,
              certificateHostnameId: row.certificateHostnameId,
              attached: row.attached,
            });
          }
        } else {
          outcome = await readAnswerGate({
            host: row.host,
            liveRevisionKey: context.liveRevisionKey,
          });
        }
      } catch (error) {
        // A check that could not run never advances and never fails the
        // domain. Nothing is written: the row keeps exactly what the last
        // check that did run found.
        if (
          error instanceof DomainCheckUnavailable ||
          error instanceof DnsLookupError ||
          error instanceof CoolifyClientError
        ) {
          return { status: "check-failed" as const };
        }
        throw error;
      }

      const failure: DomainFailure | undefined =
        outcome.state === "failed" ? outcome.failure : undefined;
      await ctx.runMutation(
        internal.evidenceLibraries.domains.writeDomainCheck,
        {
          libraryId: args.libraryId,
          domainId: args.domainId,
          state: outcome.state,
          ...(failure ? { failure } : {}),
          ...(outcome.certificateState
            ? { certificateState: outcome.certificateState }
            : {}),
        },
      );
      return {
        status: "checked" as const,
        state: outcome.state,
        ...(failure ? { failure } : {}),
        ...(outcome.certificateState
          ? { certificateState: outcome.certificateState }
          : {}),
      };
    } finally {
      await ctx.runMutation(
        internal.evidenceLibraries.domains.releaseDomainCheck,
        { domainId: args.domainId },
      );
    }
  },
});

/**
 * Starts taking the domain off the library.
 *
 * The order matters. OpenScholar refuses a domain the library calls its own
 * before it touches anything outside itself, then the proxy loses the host,
 * then the deployment that applies it runs, and only when that deployment is
 * live do the certificate and the row go. Doing it the other way round would
 * take a working site down between the steps.
 */
export const removeDomain = action({
  args: {
    libraryId: v.id("evidenceLibraries"),
    domainId: v.id("evidenceLibraryDomains"),
  },
  returns: v.object({
    status: v.union(v.literal("removed"), v.literal("removing")),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ status: "removed" | "removing" }> => {
    // Nothing outside OpenScholar has been touched yet. A domain the library
    // calls its own is refused here, before it can be taken out of the proxy.
    const started = await ctx.runMutation(
      internal.evidenceLibraries.domains.beginDomainRemoval,
      { libraryId: args.libraryId, domainId: args.domainId },
    );
    if (started.status === "gone") return { status: "removed" as const };

    const context = await ctx.runQuery(
      internal.evidenceLibraries.domains.readDomainContext,
      { libraryId: args.libraryId, domainId: args.domainId },
    );
    const row = context.domain;
    if (!row) return { status: "removed" as const };

    if (!started.attached || !context.applicationUuid) {
      // The proxy never had it, so nothing has to be redeployed.
      await finishRemoval(ctx, {
        libraryId: args.libraryId,
        domainId: args.domainId,
        certificateHostnameId: row.certificateHostnameId,
      });
      return { status: "removed" as const };
    }

    await coolify().setCustomDomains({
      applicationUuid: context.applicationUuid,
      libraryId: args.libraryId,
      publicDomain: context.platformAddress,
      currentCustomDomains: context.attachedHosts,
      customDomains: context.attachedHosts.filter(
        (entry: string) => entry !== `https://${row.host}`,
      ),
    });
    await ctx.runMutation(
      internal.evidenceLibraries.domains.writeDomainAttachment,
      { libraryId: args.libraryId, domainId: args.domainId, attached: false },
    );
    // The certificate and the row survive until this deployment is live.
    await ctx.runMutation(
      internal.evidenceLibraries.versions.startDomainDeployment,
      {
        libraryId: args.libraryId,
        domainId: args.domainId,
        host: row.host,
        reason: "detach",
      },
    );
    return { status: "removing" as const };
  },
});

async function finishRemoval(
  ctx: ActionCtx,
  input: {
    libraryId: Id<"evidenceLibraries">;
    domainId: Id<"evidenceLibraryDomains">;
    certificateHostnameId: string | null;
  },
): Promise<void> {
  const cloudflare = createPlatformCloudflareSaasClient();
  if (cloudflare && input.certificateHostnameId) {
    await cloudflare.deleteCustomHostname(input.certificateHostnameId);
  }
  await ctx.runMutation(
    internal.evidenceLibraries.domains.finishDomainRemoval,
    { domainId: input.domainId },
  );
}

/**
 * The last step of a domain change, run once its deployment is live.
 *
 * A removal only now loses its certificate and its row, because until this
 * point the running site was still serving the host. A change of the
 * library's own address is only now written down, so a failed deployment
 * never leaves OpenScholar claiming an address the site does not answer on.
 */
export const completeDomainChange = internalAction({
  args: {
    libraryId: v.id("evidenceLibraries"),
    domainId: v.id("evidenceLibraryDomains"),
    reason: v.union(
      v.literal("attach"),
      v.literal("detach"),
      v.literal("canonical"),
    ),
    address: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (args.reason === "detach") {
      const receipt = await ctx.runQuery(
        internal.evidenceLibraries.domains.readDomainReceipt,
        { domainId: args.domainId },
      );
      if (receipt) {
        await finishRemoval(ctx, {
          libraryId: args.libraryId,
          domainId: args.domainId,
          certificateHostnameId: receipt.certificateHostnameId,
        });
      }
    }
    if (args.reason === "canonical" && args.address) {
      await ctx.runMutation(
        internal.evidenceLibraries.versions.applyDomainCanonicalAddress,
        {
          libraryId: args.libraryId,
          domainId: args.domainId,
          address: args.address,
        },
      );
    }
    return null;
  },
});

/** How many working domains one sweep re-checks before it hands over. */
const SWEEP_BATCH = 20;
/** How long one sweep may run before it schedules the rest of the list. */
const SWEEP_DEADLINE_MS = 20_000;

/**
 * Re-checks the domains the platform says are working, oldest check first.
 *
 * A customer who points their domain somewhere else should stop showing as
 * working, rather than leaving a route open for ever. Each run stops at a
 * fixed deadline and schedules the next page, so a long list is walked
 * completely and no run outstays its welcome. Nothing else changes: the
 * proxy and the certificate stay until an owner removes the domain.
 */
export const sweepWorkingDomains = internalAction({
  args: { after: v.optional(v.number()) },
  returns: v.object({
    checked: v.number(),
    failed: v.number(),
    more: v.boolean(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ checked: number; failed: number; more: boolean }> => {
    const deadline = Date.now() + SWEEP_DEADLINE_MS;
    const rows = await ctx.runQuery(
      internal.evidenceLibraries.domains.listWorkingDomains,
      { limit: SWEEP_BATCH, ...(args.after === undefined ? {} : { after: args.after }) },
    );
    let failed = 0;
    let checked = 0;
    let cursor = args.after;
    for (const row of rows) {
      if (Date.now() >= deadline) break;
      cursor = row.checkedAt;
      let outcome: DomainOutcome & { certificateState?: CertificateState };
      try {
        outcome = await readAnswerGate({
          host: row.host,
          liveRevisionKey: row.liveRevisionKey,
        });
      } catch {
        // A sweep that could not run leaves the row exactly as it was, and
        // the next run reaches it again.
        continue;
      }
      checked += 1;
      if (outcome.state === "failed") failed += 1;
      // A domain that is still working has its check time moved forward too,
      // so the next page starts after it.
      await ctx.runMutation(
        internal.evidenceLibraries.domains.writeSweptDomain,
        {
          domainId: row.domainId,
          state: outcome.state,
          ...(outcome.state === "failed" ? { failure: outcome.failure } : {}),
          ...(outcome.certificateState
            ? { certificateState: outcome.certificateState }
            : {}),
        },
      );
    }
    const more = rows.length === SWEEP_BATCH;
    if (more) {
      await ctx.scheduler.runAfter(
        0,
        internal.evidenceLibraries.domainActions.sweepWorkingDomains,
        cursor === undefined ? {} : { after: cursor },
      );
    }
    return { checked, failed, more };
  },
});
