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
import { CoolifyClientError, createCoolifyClient } from "./coolifyClient";
import {
  caaScanNames,
  classifyCaaChain,
  classifyTarget as classifyTargetReading,
  classifyToken,
  DnsLookupError,
  isReservedPlatformHost,
  lookupHost,
  normaliseDomainHost,
  readAgreedAnswer,
  readAgreedIssuers,
  readsAsApex,
} from "./dnsClient";
import { DomainEgressRefused, DomainEgressUnavailable } from "./domainEgress";
import { openPinnedDomainClient } from "./domainEgressNode";
import {
  readCustomDomainApexIpv4,
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

/** Every failure that means "we could not tell", never "the domain is wrong". */
function isUnavailable(error: unknown): boolean {
  return (
    error instanceof DomainCheckUnavailable ||
    error instanceof DomainEgressUnavailable ||
    error instanceof DnsLookupError ||
    error instanceof CoolifyClientError
  );
}
import { probeEvidenceLibraryAddress } from "./readinessClient";
import { requireRuntimeEnvironment } from "./runtimeActionConfig";
import {
  evidenceLibraryDomainFailureValidator,
  evidenceLibraryDomainStateValidator,
} from "./validators";

type AddDomainResult =
  | {
      status: "added";
      domainId: Id<"evidenceLibraryDomains">;
      isApex: boolean;
    }
  | {
      status: "refused";
      reason:
        | "invalid"
        | "platform-host"
        | "host-taken"
        | "too-many"
        | "check-failed";
    };

type CheckDomainResult =
  | {
      status: "checked";
      state: "added" | "pointing" | "verified" | "active" | "failed";
      failure?: DomainFailure;
    }
  // The check could not run, or another one is already running, or the
  // domain is mid-change. None of these moves the domain's state.
  | { status: "check-failed" }
  | { status: "busy" }
  | { status: "deploying" }
  | { status: "removing" };

const checkedValidator = v.union(
  v.object({
    status: v.literal("checked"),
    state: evidenceLibraryDomainStateValidator,
    failure: v.optional(evidenceLibraryDomainFailureValidator),
  }),
  v.object({ status: v.literal("check-failed") }),
  v.object({ status: v.literal("busy") }),
  v.object({ status: v.literal("deploying") }),
  v.object({ status: v.literal("removing") }),
);

function coolify() {
  // The same reader every other Evidence Library action uses.
  const missing = (message: string) => new Error(message);
  return createCoolifyClient({
    origin: requireRuntimeEnvironment("EL_COOLIFY_URL", missing),
    token: requireRuntimeEnvironment("EL_COOLIFY_TOKEN", missing),
  });
}

/** Finds the closest DNS zone that owns a host, without following its CNAME. */
async function readVerificationHost(host: string): Promise<string> {
  for (const candidate of caaScanNames(host)) {
    if (readsAsApex(await lookupHost(fetch, candidate, "SOA"), candidate)) {
      return candidate;
    }
  }
  throw new DnsLookupError("The domain could not be checked");
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
      isApex: v.boolean(),
    }),
    v.object({
      status: v.literal("refused"),
      reason: v.union(
        v.literal("invalid"),
        v.literal("platform-host"),
        v.literal("host-taken"),
        v.literal("too-many"),
        v.literal("check-failed"),
      ),
    }),
  ),
  handler: async (ctx, args): Promise<AddDomainResult> => {
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
    let isApex: boolean;
    let verificationHost: string;
    try {
      verificationHost = await readVerificationHost(host);
      isApex = verificationHost === host;
      if (isApex) readCustomDomainApexIpv4();
    } catch {
      return { status: "refused" as const, reason: "check-failed" as const };
    }
    const claimed = await ctx.runMutation(
      internal.evidenceLibraries.domains.claimDomainHost,
      { libraryId: args.libraryId, host, isApex, verificationHost },
    );
    if (claimed.status !== "added") {
      return { status: "refused" as const, reason: claimed.status };
    }
    return {
      status: "added" as const,
      domainId: claimed.domainId,
      isApex,
    };
  },
});

/** The addresses our CNAME target answers with, as both resolvers see them. */
async function readTargetAddresses(target: string): Promise<string[]> {
  return readAgreedAnswer(await lookupHost(fetch, target, "A"), (answer) =>
    answer.addresses.slice().sort().join(","),
  )
    .split(",")
    .filter(Boolean);
}

/** Reads the closest CAA set and checks that Traefik may renew the certificate. */
async function readCaaGate(
  host: string,
  renewLease: () => Promise<void>,
): Promise<"ok" | "blocked"> {
  const chain: string[][] = [];
  for (const name of caaScanNames(host)) {
    // The issuers travel as an array: an issuer that permits nobody is
    // written as an empty value, which joining would lose.
    chain.push(readAgreedIssuers(await lookupHost(fetch, name, "CAA")));
    await renewLease();
  }
  return classifyCaaChain(chain);
}

/** Reads the two records the owner was asked to add. */
async function readRecordGates(
  host: string,
  verificationHost: string,
  token: string,
  renewLease: () => Promise<void>,
): Promise<DomainOutcome & { isApex: boolean }> {
  const target = readCustomDomainTarget();
  const [targetAnswers, tokenAnswers] = await Promise.all([
    lookupHost(fetch, host, "A"),
    lookupHost(fetch, verificationRecordName(verificationHost), "TXT"),
  ]);
  const targetAddresses = await readTargetAddresses(target);
  const isApex = verificationHost === host;
  const targetReading = readAgreedAnswer(targetAnswers, (answer) =>
    classifyTargetReading(answer, {
      target,
      targetAddresses,
      isApex,
      apexAddresses: isApex ? [readCustomDomainApexIpv4()] : [],
    }),
  );
  const tokenReading = readAgreedAnswer(tokenAnswers, (answer) =>
    classifyToken(answer, verificationRecordValue(token)),
  );
  // CAA only matters once the name reaches us.
  let caa: "ok" | "blocked" = "ok";
  if (targetReading === "pointing") {
    caa = await readCaaGate(host, renewLease);
  }
  return {
    ...readDomainRecords({ target: targetReading, caa, token: tokenReading }),
    // The top of a zone cannot carry the alias we ask for. Which names are
    // tops of zones is read from DNS, not counted from the parts of a name.
    isApex,
  };
}

/**
 * Hands a verified domain to the proxy, then publishes the library again so
 * the router and its Let's Encrypt resolver reach the running site.
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
    token: string;
    host: string;
    platformAddress: string;
    applicationUuid: string;
    attachedHosts: readonly string[];
    /** Hosts the proxy was asked to hold and never confirmed. */
    uncertainHosts: readonly string[];
    generation: number;
  },
): Promise<DomainOutcome> {
  // Running this again with the host already in the list
  // writes nothing, so a retry is safe.
  // A set, not a list: this host may already be in the proxy from an attempt
  // that stopped before its receipt, and asking for it twice would be wrong.
  const wanted = [
    ...new Set([
      ...input.attachedHosts,
      ...input.uncertainHosts,
      `https://${input.host}`,
    ]),
  ].sort();
  // Written before the call, so a crash between the proxy accepting the
  // host and the receipt being saved is still visible: the next attempt
  // sees the host may already be there and running it again writes nothing.
  await ctx.runMutation(
    internal.evidenceLibraries.domains.writeDomainAttachmentIntent,
    { domainId: input.domainId, token: input.token },
  );
  await holdDomain(ctx, input.domainId, input.token);
  try {
    await coolify().setCustomDomains({
      applicationUuid: input.applicationUuid,
      libraryId: input.libraryId,
      publicDomain: input.platformAddress,
      // Either safe state: the proxy may already hold the hosts an earlier
      // attempt asked about, or it may not.
      currentCustomDomains: [
        [...input.attachedHosts].sort(),
        [...new Set([...input.attachedHosts, ...input.uncertainHosts])].sort(),
      ],
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
  // The proxy holds the host and a deployment is owed. Both are written
  // together, so a crash here cannot look like a finished attach.
  await ctx.runMutation(
    internal.evidenceLibraries.domains.writeDomainAttachment,
    {
      libraryId: input.libraryId,
      domainId: input.domainId,
      token: input.token,
      attached: true,
      deploymentPending: true,
    },
  );

  await queueDomainDeployment(ctx, {
    libraryId: input.libraryId,
    domainId: input.domainId,
    token: input.token,
    generation: input.generation,
    host: input.host,
    reason: "attach",
  });
  return { state: "verified" };
}

/**
 * Queues the deployment that carries a proxy change to the running site, and
 * only then forgets that one was owed.
 */
async function queueDomainDeployment(
  ctx: ActionCtx,
  input: {
    libraryId: Id<"evidenceLibraries">;
    domainId: Id<"evidenceLibraryDomains">;
    token: string;
    generation: number;
    host: string;
    reason: "attach" | "detach";
  },
): Promise<void> {
  await ctx.runMutation(
    internal.evidenceLibraries.versions.startDomainDeployment,
    {
      libraryId: input.libraryId,
      domainId: input.domainId,
      generation: input.generation,
      token: input.token,
      host: input.host,
      reason: input.reason,
    },
  );
  // The change stays owed until that deployment succeeds. Only the
  // deployment's own completion clears it.
}

/** Asks the domain itself whether this library answers on it. */
async function readAnswerGate(input: {
  host: string;
  liveRevisionKey: string | null;
  renewLease: () => Promise<void>;
}): Promise<DomainOutcome> {
  // CAA can change after a domain is attached. Read it before HTTPS so a
  // blocked renewal has a useful answer instead of looking unreachable for
  // ever.
  if ((await readCaaGate(input.host, input.renewLease)) === "blocked") {
    return { state: "failed", failure: "caa-blocked" };
  }
  // Where the domain points is settled first, because it is conclusive on
  // its own: a domain repointed somewhere else, or at an address inside our
  // own network, has stopped working before an HTTPS probe is attempted.
  let pinned: typeof fetch;
  try {
    pinned = await openPinnedDomainClient({ host: input.host });
  } catch (error) {
    if (error instanceof DomainEgressRefused) {
      return { state: "failed", failure: "wrong-target" };
    }
    throw error;
  }
  const address = await probeEvidenceLibraryAddress({
    targetBaseUrl: `https://${input.host}`,
    fetchImpl: pinned,
  });
  // Nothing answered. That is not an answer about the domain, so nothing is
  // written and a working domain is never pushed back by a bad moment.
  if (address.state === "unreachable") throw new DomainCheckUnavailable();
  return readDomainAnswer({
    address: address.state,
    liveRevision:
      address.revision !== null && address.revision === input.liveRevisionKey,
  });
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
      internal.evidenceLibraries.domains.claimDomainTransition,
      {
        libraryId: args.libraryId,
        domainId: args.domainId,
        kind: "check",
        spendBudget: true,
      },
    );
    if (claimed.status === "busy") return { status: "busy" as const };
    const token = claimed.token;
    // A step that hands the domain to a deployment keeps the lease: the
    // deployment now holds it, and its own completion gives it back.
    let heldByDeployment = false;
    const renewLease = async () => {
      await ctx.runMutation(
        internal.evidenceLibraries.domains.renewDomainTransition,
        { domainId: args.domainId, token },
      );
    };
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
        ...(row.deploymentPending ? { deploymentPending: true } : {}),
        ...(row.removing ? { removing: true } : {}),
      });
      // A domain on its way out is left alone: reattaching it would race the
      // removal that is already running.
      if (step === "blocked") return { status: "removing" as const };

      let outcome: DomainOutcome & { isApex?: boolean };
      try {
        if (step === "deploy") {
          // The proxy was changed but the deployment carrying it was never
          // queued. Queue it and stop; the next check reads the result.
          if (!context.applicationUuid || !context.liveRevisionKey) {
            throw new DomainCheckUnavailable();
          }
          await queueDomainDeployment(ctx, {
            libraryId: args.libraryId,
            domainId: args.domainId,
            token,
            generation: row.generation,
            host: row.host,
            reason: row.attached ? "attach" : "detach",
          });
          heldByDeployment = true;
          return { status: "deploying" as const };
        }
        if (step === "records") {
          outcome = await readRecordGates(
            row.host,
            row.verificationHost,
            row.verificationToken,
            renewLease,
          );
        } else if (step === "attach") {
          if (!context.applicationUuid || !context.liveRevisionKey) {
            outcome = { state: "failed", failure: "not-served" };
          } else {
            outcome = await attachDomain(ctx, {
              libraryId: args.libraryId,
              domainId: args.domainId,
              token,
              host: row.host,
              platformAddress: context.platformAddress,
              applicationUuid: context.applicationUuid,
              attachedHosts: context.attachedHosts,
              uncertainHosts: context.uncertainHosts,
              generation: row.generation,
            });
            // Attaching queues a deployment, which now holds the domain.
            if (outcome.state !== "failed") heldByDeployment = true;
          }
        } else {
          outcome = await readAnswerGate({
            host: row.host,
            liveRevisionKey: context.liveRevisionKey,
            renewLease,
          });
        }
      } catch (error) {
        // A check that could not run never advances and never fails the
        // domain. Nothing is written: the row keeps exactly what the last
        // check that did run found.
        if (isUnavailable(error)) return { status: "check-failed" as const };
        throw error;
      }

      const failure: DomainFailure | undefined =
        outcome.state === "failed" ? outcome.failure : undefined;
      await ctx.runMutation(
        internal.evidenceLibraries.domains.writeDomainCheck,
        {
          libraryId: args.libraryId,
          domainId: args.domainId,
          token,
          state: outcome.state,
          ...(outcome.isApex === undefined ? {} : { isApex: outcome.isApex }),
          ...(failure ? { failure } : {}),
        },
      );
      return {
        status: "checked" as const,
        state: outcome.state,
        ...(failure ? { failure } : {}),
      };
    } finally {
      if (!heldByDeployment) {
        await ctx.runMutation(
          internal.evidenceLibraries.domains.releaseDomainTransition,
          { domainId: args.domainId, token },
        );
      }
    }
  },
});

/**
 * Starts taking the domain off the library.
 *
 * The order matters. OpenScholar refuses a domain the library calls its own
 * before it touches anything outside itself, then the proxy loses the host,
 * then the deployment that applies it runs, and only when that deployment is
 * live does the row go. Doing it the other way round would take a working
 * site down between the steps.
 */
export const removeDomain = action({
  args: {
    libraryId: v.id("evidenceLibraries"),
    domainId: v.id("evidenceLibraryDomains"),
  },
  returns: v.object({
    status: v.union(
      v.literal("removed"),
      v.literal("removing"),
      v.literal("busy"),
    ),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ status: "removed" | "removing" | "busy" }> => {
    // The same lease every other change to this domain takes, so a removal
    // never starts under a running check or attach.
    const claimed = await ctx.runMutation(
      internal.evidenceLibraries.domains.claimDomainTransition,
      { libraryId: args.libraryId, domainId: args.domainId, kind: "remove" },
    );
    if (claimed.status === "busy") return { status: "busy" as const };
    const token = claimed.token;
    let releaseLease = true;
    try {
      // Nothing outside OpenScholar has been touched yet. A domain the
      // library calls its own is refused here, before it can be taken out of
      // the proxy.
      const started = await ctx.runMutation(
        internal.evidenceLibraries.domains.beginDomainRemoval,
        { libraryId: args.libraryId, domainId: args.domainId, token },
      );
      if (started.status === "gone") return { status: "removed" as const };

      const context = await ctx.runQuery(
        internal.evidenceLibraries.domains.readDomainContext,
        { libraryId: args.libraryId, domainId: args.domainId },
      );
      const row = context.domain;
      if (!row) return { status: "removed" as const };

      // An attach that asked the proxy and stopped before saving its
      // receipt is taken back out too, so no host is left behind there.
      const wasKnownToProxy = row.attached || row.attachIntent;
      if (wasKnownToProxy && context.applicationUuid) {
        await holdDomain(ctx, args.domainId, token);
        await coolify().setCustomDomains({
          applicationUuid: context.applicationUuid,
          libraryId: args.libraryId,
          publicDomain: context.platformAddress,
          currentCustomDomains: [
            [...context.attachedHosts].sort(),
            [
              ...new Set([...context.attachedHosts, ...context.uncertainHosts]),
            ].sort(),
          ],
          customDomains: [
            ...new Set([...context.attachedHosts, ...context.uncertainHosts]),
          ]
            .filter((entry: string) => entry !== `https://${row.host}`)
            .sort(),
        });
        // The proxy no longer holds the host and a deployment is owed.
        // Written together, so a crash here cannot look like a finished
        // removal.
        await ctx.runMutation(
          internal.evidenceLibraries.domains.writeDomainAttachment,
          {
            libraryId: args.libraryId,
            domainId: args.domainId,
            token,
            attached: false,
            deploymentPending: true,
          },
        );
      }

      // Either the proxy just lost the host, or a previous attempt got that
      // far and stopped before the deployment finished. A host the proxy was
      // only asked about counts too: it was just taken back out, and that
      // has to reach the running site.
      const owed = wasKnownToProxy || row.deploymentPending;
      if (owed && context.applicationUuid) {
        await queueDomainDeployment(ctx, {
          libraryId: args.libraryId,
          domainId: args.domainId,
          token,
          generation: row.generation,
          host: row.host,
          reason: "detach",
        });
        // The row survives until that deployment is live, and the lease is
        // held until then so nothing else touches it.
        releaseLease = false;
        return { status: "removing" as const };
      }

      // The proxy never had it, so nothing has to be redeployed.
      await ctx.runMutation(
        internal.evidenceLibraries.domains.finishDomainRemoval,
        { domainId: args.domainId, token },
      );
      return { status: "removed" as const };
    } finally {
      if (releaseLease) {
        await ctx.runMutation(
          internal.evidenceLibraries.domains.releaseDomainTransition,
          { domainId: args.domainId, token },
        );
      }
    }
  },
});

/**
 * Proves this change still owns the domain, immediately before writing
 * anywhere outside OpenScholar.
 */
async function holdDomain(
  ctx: ActionCtx,
  domainId: Id<"evidenceLibraryDomains">,
  token: string,
): Promise<void> {
  await ctx.runMutation(
    internal.evidenceLibraries.domains.holdDomainTransition,
    { domainId, token },
  );
}

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
 * proxy route stays until an owner removes the domain.
 */
export const sweepWorkingDomains = internalAction({
  args: {
    /** Fixed when the sweep starts; rows checked after it are already done. */
    cutoff: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.object({
    checked: v.number(),
    failed: v.number(),
    more: v.boolean(),
    /** Where the next page starts, when there is one. */
    next: v.optional(
      v.object({
        cutoff: v.number(),
        cursor: v.union(v.string(), v.null()),
      }),
    ),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    checked: number;
    failed: number;
    more: boolean;
    next?: { cutoff: number; cursor: string | null };
  }> => {
    const cutoff = args.cutoff ?? Date.now();
    const deadline = Date.now() + SWEEP_DEADLINE_MS;
    const page = await ctx.runQuery(
      internal.evidenceLibraries.domains.listWorkingDomains,
      {
        limit: SWEEP_BATCH,
        cutoff,
        ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
      },
    );
    let failed = 0;
    let checked = 0;
    let stopped = false;
    for (const row of page.rows) {
      if (Date.now() >= deadline) {
        stopped = true;
        break;
      }
      // Something else is already changing this domain.
      if (row.busy) continue;
      let outcome: DomainOutcome;
      try {
        outcome = await readAnswerGate({
          host: row.host,
          liveRevisionKey: row.liveRevisionKey,
          renewLease: async () => undefined,
        });
      } catch (error) {
        // A sweep that could not read a domain leaves it exactly as it was,
        // and the next sweep reaches it again.
        if (isUnavailable(error)) continue;
        throw error;
      }
      checked += 1;
      if (outcome.state === "failed") failed += 1;
      // A domain that is still working has its check time moved forward too,
      // past the cutoff, so this sweep never sees it again.
      await ctx.runMutation(
        internal.evidenceLibraries.domains.writeSweptDomain,
        {
          domainId: row.domainId,
          expectedGeneration: row.generation,
          state: outcome.state,
          ...(outcome.state === "failed" ? { failure: outcome.failure } : {}),
        },
      );
    }
    // Whether the page ran out or the deadline did, the next run starts
    // after this page. A row that could not be read keeps its old check
    // time and the next sweep reaches it, so one slow domain never holds
    // the rest up.
    const more = stopped || !page.done;
    if (!more) return { checked, failed, more: false };
    const next = { cutoff, cursor: page.cursor };
    await ctx.scheduler.runAfter(
      0,
      internal.evidenceLibraries.domainActions.sweepWorkingDomains,
      next,
    );
    return { checked, failed, more: true, next };
  },
});
