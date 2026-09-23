"use node";

/**
 * What the Domain section's buttons do.
 *
 * Owners add, check, and remove domains here. One check verifies every row,
 * publishes the verified hosts together, then finishes TLS checks in the
 * background. A step that could not run answers `check-failed`.
 */

import { ConvexError, v } from "convex/values";
import { getDomain } from "tldts";
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
import {
  probeEvidenceLibraryAddress,
  ReadinessClientError,
  setLibraryDomainRoutes,
} from "./readinessClient";
import {
  requireRuntimeEnvironment,
  requireRuntimeHttpsOrigin,
} from "./runtimeActionConfig";
import {
  evidenceLibraryDomainFailureValidator,
  evidenceLibraryDomainStateValidator,
} from "./validators";

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
    error instanceof CoolifyClientError ||
    (error instanceof ReadinessClientError &&
      (error.code === "READINESS_UNAVAILABLE" ||
        error.code === "RUNTIME_ROUTE_UNAVAILABLE"))
  );
}

function isRateLimited(error: unknown): boolean {
  const data = error instanceof ConvexError ? error.data : undefined;
  return (
    (typeof data === "object" &&
      data !== null &&
      "kind" in data &&
      data.kind === "RateLimited") ||
    (error instanceof Error && error.message.includes('"kind":"RateLimited"'))
  );
}

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

type CheckedDomain = {
  domainId: Id<"evidenceLibraryDomains">;
  state: "added" | "pointing" | "verified" | "active" | "failed";
  failure?: DomainFailure;
};

type CheckDomainsResult = {
  status: "checked" | "check-failed" | "busy" | "deploying" | "rate-limited";
  results: CheckedDomain[];
};

const checkedDomainsValidator = v.object({
  status: v.union(
    v.literal("checked"),
    v.literal("check-failed"),
    v.literal("busy"),
    v.literal("deploying"),
    v.literal("rate-limited"),
  ),
  results: v.array(
    v.object({
      domainId: v.id("evidenceLibraryDomains"),
      state: evidenceLibraryDomainStateValidator,
      failure: v.optional(evidenceLibraryDomainFailureValidator),
    }),
  ),
});

/**
 * Writes this library's custom-domain route file, which the proxy reloads by
 * itself, so a change is live in seconds. It says what is recorded at the
 * moment of writing, and only one writer runs at a time, so the last write
 * always carries the newest set. "unsupported": the runtime verifier predates
 * route files, and a deployment has to carry the change. "busy": another
 * write, or a configuration deployment, is running.
 */
async function syncDomainRoutes(
  ctx: ActionCtx,
  libraryId: Id<"evidenceLibraries">,
  platform?: true,
): Promise<"routed" | "unsupported" | "busy"> {
  const claim = await ctx.runMutation(
    internal.evidenceLibraries.domains.claimDomainRoutes,
    { libraryId, ...(platform ? { platform } : {}) },
  );
  if (claim.status === "busy") return "busy";
  try {
    const missing = (message: string) => new Error(message);
    const routed = await setLibraryDomainRoutes({
      applicationUuid: claim.applicationUuid,
      customOrigins: claim.hosts,
      verifierUrl: requireRuntimeHttpsOrigin(
        "EL_RUNTIME_VERIFIER_URL",
        missing,
      ),
      verifierToken: requireRuntimeEnvironment(
        "EL_RUNTIME_VERIFIER_TOKEN",
        missing,
      ),
    });
    return routed.status === "routed" ? "routed" : "unsupported";
  } finally {
    await ctx.runMutation(
      internal.evidenceLibraries.domains.releaseDomainRoutes,
      { libraryId, token: claim.token },
    );
  }
}

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
    // A public suffix such as `co.uk` is a DNS zone, but no customer can add
    // an ownership record there.
    if (getDomain(candidate) === null) continue;
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
  isApex: boolean,
  token: string,
  renewLease: () => Promise<void>,
): Promise<DomainOutcome> {
  const target = readCustomDomainTarget();
  const [targetAnswers, tokenAnswers] = await Promise.all([
    lookupHost(fetch, host, "A"),
    lookupHost(fetch, verificationRecordName(verificationHost), "TXT"),
  ]);
  const targetAddresses = await readTargetAddresses(target);
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
async function attachDomains(
  ctx: ActionCtx,
  input: {
    libraryId: Id<"evidenceLibraries">;
    platformAddress: string;
    applicationUuid: string;
    attachedHosts: readonly string[];
    /** Hosts the proxy was asked to hold and never confirmed. */
    uncertainHosts: readonly string[];
    changes: Array<{
      domainId: Id<"evidenceLibraryDomains">;
      token: string;
      host: string;
      generation: number;
      attach: boolean;
    }>;
  },
): Promise<{
  deploying: boolean;
  deployed: Id<"evidenceLibraryDomains">[];
  failed: Id<"evidenceLibraryDomains">[];
  /** Live through a route file, with no deployment: still to be proven. */
  routed: Id<"evidenceLibraryDomains">[];
}> {
  const newAttachments = input.changes.filter((change) => change.attach);
  // Coolify keeps the list too, so its check that no other site holds a host
  // still runs, and its own routes catch up at the next deployment. The route
  // file is written from the records, so every receipt above lands first.
  const routeInstead = async (
    changes: typeof input.changes,
  ): Promise<boolean> => {
    for (const change of changes) {
      await holdDomain(ctx, change.domainId, change.token);
    }
    const synced = await syncDomainRoutes(ctx, input.libraryId);
    if (synced === "unsupported") return false;
    // Recorded as owing a deployment, so the next check carries on from here.
    if (synced === "busy") throw new DomainCheckUnavailable();
    for (const change of changes) {
      await ctx.runMutation(
        internal.evidenceLibraries.domains.settleRoutedDomain,
        {
          libraryId: input.libraryId,
          domainId: change.domainId,
          token: change.token,
          attached: true,
        },
      );
    }
    return true;
  };
  const wanted = [
    ...new Set([
      ...input.attachedHosts,
      ...input.uncertainHosts,
      ...newAttachments.map((change) => `https://${change.host}`),
    ]),
  ].sort();
  if (newAttachments.length > 0) {
    for (const change of newAttachments) {
      await ctx.runMutation(
        internal.evidenceLibraries.domains.writeDomainAttachmentIntent,
        { domainId: change.domainId, token: change.token },
      );
      await holdDomain(ctx, change.domainId, change.token);
    }
    const accepted: typeof newAttachments = [];
    const failed: typeof newAttachments = [];
    try {
      await coolify().setCustomDomains({
        applicationUuid: input.applicationUuid,
        libraryId: input.libraryId,
        publicDomain: input.platformAddress,
        currentCustomDomains: [
          [...input.attachedHosts].sort(),
          [
            ...new Set([...input.attachedHosts, ...input.uncertainHosts]),
          ].sort(),
        ],
        customDomains: wanted,
      });
      accepted.push(...newAttachments);
    } catch (error) {
      if (
        !(error instanceof CoolifyClientError) ||
        error.code !== "COOLIFY_DOMAIN_TAKEN"
      ) {
        throw error;
      }
      const kept = new Set([...input.attachedHosts, ...input.uncertainHosts]);
      let possibleCurrent = [[...input.attachedHosts].sort(), [...kept].sort()];
      for (const change of newAttachments) {
        const next = [...kept, `https://${change.host}`].sort();
        try {
          await coolify().setCustomDomains({
            applicationUuid: input.applicationUuid,
            libraryId: input.libraryId,
            publicDomain: input.platformAddress,
            currentCustomDomains: possibleCurrent,
            customDomains: next,
          });
          kept.add(`https://${change.host}`);
          possibleCurrent = [[...kept].sort()];
          accepted.push(change);
        } catch (candidateError) {
          if (
            candidateError instanceof CoolifyClientError &&
            candidateError.code === "COOLIFY_DOMAIN_TAKEN"
          ) {
            failed.push(change);
            continue;
          }
          throw candidateError;
        }
      }
    }
    for (const change of accepted) {
      await ctx.runMutation(
        internal.evidenceLibraries.domains.writeDomainAttachment,
        {
          libraryId: input.libraryId,
          domainId: change.domainId,
          token: change.token,
          attached: true,
          deploymentPending: true,
        },
      );
    }
    for (const change of failed) {
      await ctx.runMutation(
        internal.evidenceLibraries.domains.writeDomainAttachment,
        {
          libraryId: input.libraryId,
          domainId: change.domainId,
          token: change.token,
          attached: false,
          deploymentPending: false,
        },
      );
    }
    const deployed = [
      ...input.changes.filter((change) => !change.attach),
      ...accepted,
    ];
    if (deployed.length === 0) {
      return {
        deploying: false,
        deployed: [],
        failed: failed.map((change) => change.domainId),
        routed: [],
      };
    }
    if (await routeInstead(deployed)) {
      return {
        deploying: false,
        deployed: [],
        failed: failed.map((change) => change.domainId),
        routed: deployed.map((change) => change.domainId),
      };
    }
    await ctx.runMutation(
      internal.evidenceLibraries.versions.startDomainDeploymentBatch,
      {
        libraryId: input.libraryId,
        changes: deployed.map(({ domainId, generation, host, token }) => ({
          domainId,
          generation,
          host,
          token,
        })),
      },
    );
    return {
      deploying: true,
      deployed: deployed.map((change) => change.domainId),
      failed: failed.map((change) => change.domainId),
      routed: [],
    };
  }
  const deployed = input.changes;
  if (await routeInstead(deployed)) {
    return {
      deploying: false,
      deployed: [],
      failed: [],
      routed: deployed.map((change) => change.domainId),
    };
  }
  await ctx.runMutation(
    internal.evidenceLibraries.versions.startDomainDeploymentBatch,
    {
      libraryId: input.libraryId,
      changes: deployed.map(({ domainId, generation, host, token }) => ({
        domainId,
        generation,
        host,
        token,
      })),
    },
  );
  return {
    deploying: true,
    deployed: deployed.map((change) => change.domainId),
    failed: [],
    routed: [],
  };
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
  runtimeCommit: string | null;
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
    ...(input.runtimeCommit && input.liveRevisionKey
      ? {
          expectedRuntimeRoute: {
            runtimeCommit: input.runtimeCommit,
            revisionKey: input.liveRevisionKey,
          },
        }
      : {}),
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

/** Checks every incomplete domain and batches all verified hosts into one deploy. */
export const checkDomains = action({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: checkedDomainsValidator,
  handler: async (ctx, args): Promise<CheckDomainsResult> => {
    const first = await ctx.runQuery(
      internal.evidenceLibraries.domains.readDomainContext,
      { libraryId: args.libraryId },
    );
    const targetIds = first.domains
      .filter((row) => row.state !== "active" && !row.removing)
      .map((row) => row.domainId);
    if (targetIds.length === 0) return { status: "checked", results: [] };

    let claimed;
    try {
      claimed = await ctx.runMutation(
        internal.evidenceLibraries.domains.claimDomainTransitions,
        { libraryId: args.libraryId, domainIds: targetIds },
      );
    } catch (error) {
      if (isRateLimited(error)) {
        return { status: "rate-limited", results: [] };
      }
      throw error;
    }
    if (claimed.status === "busy") return { status: "busy", results: [] };

    const context = await ctx.runQuery(
      internal.evidenceLibraries.domains.readDomainContext,
      { libraryId: args.libraryId },
    );
    const claims = new Map(
      claimed.claims.map((claim) => [claim.domainId, claim]),
    );
    const held = new Set(claimed.claims.map((claim) => claim.domainId));
    const results: CheckedDomain[] = [];
    const deploymentChanges: Array<{
      domainId: Id<"evidenceLibraryDomains">;
      token: string;
      host: string;
      generation: number;
      attach: boolean;
    }> = [];
    let unavailable = 0;

    const release = async (domainId: Id<"evidenceLibraryDomains">) => {
      const claim = claims.get(domainId);
      if (!claim || !held.delete(domainId)) return;
      await ctx.runMutation(
        internal.evidenceLibraries.domains.releaseDomainTransition,
        { domainId, token: claim.token },
      );
    };
    const write = async (
      row: (typeof context.domains)[number],
      outcome: DomainOutcome,
    ) => {
      const claim = claims.get(row.domainId)!;
      const failure = outcome.state === "failed" ? outcome.failure : undefined;
      await ctx.runMutation(
        internal.evidenceLibraries.domains.writeDomainCheck,
        {
          libraryId: args.libraryId,
          domainId: row.domainId,
          token: claim.token,
          state: outcome.state,
          ...(failure ? { failure } : {}),
        },
      );
      results.push({
        domainId: row.domainId,
        state: outcome.state,
        ...(failure ? { failure } : {}),
      });
    };

    try {
      for (const row of context.domains.filter((entry) =>
        claims.has(entry.domainId),
      )) {
        const claim = claims.get(row.domainId)!;
        const renewLease = async () => {
          await ctx.runMutation(
            internal.evidenceLibraries.domains.renewDomainTransition,
            { domainId: row.domainId, token: claim.token },
          );
        };
        const step = nextDomainStep({
          state: row.state,
          ...(row.attached ? { attachedAt: 1 } : {}),
          ...(row.deploymentPending ? { deploymentPending: true } : {}),
          ...(row.removing ? { removing: true } : {}),
        });
        if (step === "blocked") {
          await release(row.domainId);
          continue;
        }
        if (step === "attach") {
          deploymentChanges.push({
            domainId: row.domainId,
            token: claim.token,
            host: row.host,
            generation: claim.generation,
            attach: true,
          });
          continue;
        }
        if (step === "deploy") {
          let live: DomainOutcome | null = null;
          try {
            live = await readAnswerGate({
              host: row.host,
              runtimeCommit: context.runtimeCommit,
              liveRevisionKey: context.liveRevisionKey,
              renewLease,
            });
          } catch (error) {
            if (!isUnavailable(error)) throw error;
          }
          if (live?.state === "active" && row.recoverableDeployment) {
            await ctx.runMutation(
              internal.evidenceLibraries.domains.recoverLiveDomain,
              {
                libraryId: args.libraryId,
                domainId: row.domainId,
                token: claim.token,
                expectedGeneration: claim.generation,
              },
            );
            held.delete(row.domainId);
            results.push({ domainId: row.domainId, state: "active" });
            continue;
          }
          if (live?.state === "failed") {
            await write(row, live);
            await release(row.domainId);
            continue;
          }
          deploymentChanges.push({
            domainId: row.domainId,
            token: claim.token,
            host: row.host,
            generation: claim.generation,
            attach: false,
          });
          continue;
        }
        let outcome: DomainOutcome;
        try {
          outcome =
            step === "records"
              ? await readRecordGates(
                  row.host,
                  row.verificationHost,
                  row.isApex,
                  row.verificationToken,
                  renewLease,
                )
              : await readAnswerGate({
                  host: row.host,
                  runtimeCommit: context.runtimeCommit,
                  liveRevisionKey: context.liveRevisionKey,
                  renewLease,
                });
        } catch (error) {
          if (!isUnavailable(error)) throw error;
          unavailable += 1;
          await release(row.domainId);
          continue;
        }
        await write(row, outcome);
        if (step === "records" && outcome.state === "verified") {
          deploymentChanges.push({
            domainId: row.domainId,
            token: claim.token,
            host: row.host,
            generation: claim.generation,
            attach: true,
          });
        } else {
          await release(row.domainId);
        }
      }

      if (deploymentChanges.length === 0) {
        return {
          status:
            results.length === 0 && unavailable > 0
              ? "check-failed"
              : "checked",
          results,
        };
      }
      const ready = new Set([
        ...deploymentChanges.map((change) => change.domainId),
        ...results
          .filter((result) => result.state === "active")
          .map((result) => result.domainId),
      ]);
      if (!targetIds.every((domainId) => ready.has(domainId))) {
        for (const change of deploymentChanges) {
          await release(change.domainId);
        }
        return {
          status:
            results.length === 0 && unavailable > 0
              ? "check-failed"
              : "checked",
          results,
        };
      }
      if (!context.applicationUuid || !context.liveRevisionKey) {
        for (const change of deploymentChanges) {
          if (change.attach) {
            const row = context.domains.find(
              (entry) => entry.domainId === change.domainId,
            )!;
            await write(row, { state: "failed", failure: "not-served" });
          } else {
            unavailable += 1;
          }
          await release(change.domainId);
        }
        return {
          status:
            results.length === 0 && unavailable > 0
              ? "check-failed"
              : "checked",
          results,
        };
      }
      let attached: Awaited<ReturnType<typeof attachDomains>>;
      try {
        attached = await attachDomains(ctx, {
          libraryId: args.libraryId,
          platformAddress: context.platformAddress,
          applicationUuid: context.applicationUuid,
          attachedHosts: context.attachedHosts,
          uncertainHosts: context.uncertainHosts,
          changes: deploymentChanges,
        });
      } catch (error) {
        if (!isUnavailable(error)) throw error;
        return { status: "check-failed", results };
      }
      for (const domainId of attached.failed) {
        const change = deploymentChanges.find(
          (entry) => entry.domainId === domainId,
        )!;
        if (change.attach) {
          const row = context.domains.find(
            (entry) => entry.domainId === change.domainId,
          )!;
          await write(row, { state: "failed", failure: "host-taken" });
          await release(change.domainId);
        }
      }
      for (const domainId of attached.deployed) held.delete(domainId);
      if (attached.routed.length > 0) {
        // Nothing holds these any more; the HTTPS proof below writes their
        // final state once the proxy serves them with a certificate.
        for (const domainId of attached.routed) await release(domainId);
        await ctx.scheduler.runAfter(
          0,
          internal.evidenceLibraries.domainActions.activateDomains,
          { libraryId: args.libraryId, domainIds: attached.routed, attempt: 0 },
        );
      }
      return {
        status:
          attached.deploying || attached.routed.length > 0
            ? "deploying"
            : "checked",
        results,
      };
    } finally {
      for (const domainId of [...held]) await release(domainId);
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
  ): Promise<{ status: "removed" | "removing" | "busy" }> =>
    await removeLibraryDomain(ctx, args),
});

/**
 * Takes off the main addresses an owner removed, once their activation has
 * moved the library to another address. Runs with no owner signed in; a
 * domain it cannot finish is left for the owner's Remove button.
 */
export const removeStagedDomains = internalAction({
  args: {
    libraryId: v.id("evidenceLibraries"),
    /** When the activation that carried these removals started. */
    stagedBefore: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staged = await ctx.runQuery(
      internal.evidenceLibraries.domains.readStagedRemovals,
      { libraryId: args.libraryId, stagedBefore: args.stagedBefore },
    );
    for (const domainId of staged) {
      try {
        await removeLibraryDomain(
          ctx,
          { libraryId: args.libraryId, domainId },
          { stagedBefore: args.stagedBefore },
        );
      } catch (error) {
        console.error("[evidence-library] staged domain removal failed", {
          libraryId: args.libraryId,
          domainId,
          error,
        });
      }
    }
    return null;
  },
});

async function removeLibraryDomain(
  ctx: ActionCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    domainId: Id<"evidenceLibraryDomains">;
  },
  /** Set for the platform's own work, which only takes what is still staged. */
  staged?: { stagedBefore: number },
): Promise<{ status: "removed" | "removing" | "busy" }> {
  const platform = staged ? (true as const) : undefined;
  // The same lease every other change to this domain takes, so a removal
  // never starts under a running check or attach.
  const claimed = await ctx.runMutation(
    internal.evidenceLibraries.domains.claimDomainTransition,
    {
      libraryId: args.libraryId,
      domainId: args.domainId,
      kind: "remove",
      ...(platform ? { platform } : {}),
    },
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
      {
        libraryId: args.libraryId,
        domainId: args.domainId,
        token,
        ...(staged ? { platform, stagedBefore: staged.stagedBefore } : {}),
      },
    );
    if (started.status === "gone") return { status: "removed" as const };
    // The owner kept it after all.
    if (started.status === "kept") return { status: "busy" as const };

    const context = await ctx.runQuery(
      internal.evidenceLibraries.domains.readDomainContext,
      {
        libraryId: args.libraryId,
        domainId: args.domainId,
        ...(platform ? { platform } : {}),
      },
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
          ...(platform ? { platform } : {}),
        },
      );
    }

    // Either the proxy just lost the host, or a previous attempt got that
    // far and stopped before the deployment finished. A host the proxy was
    // only asked about counts too: it was just taken back out, and that
    // has to reach the running site.
    const owed = wasKnownToProxy || row.deploymentPending;
    if (owed && context.applicationUuid) {
      // The row already says the proxy lost the host, so the route file
      // written from the records leaves it out.
      await holdDomain(ctx, args.domainId, token);
      const synced = await syncDomainRoutes(ctx, args.libraryId, platform);
      if (synced === "routed") {
        await ctx.runMutation(
          internal.evidenceLibraries.domains.settleRoutedDomain,
          {
            libraryId: args.libraryId,
            domainId: args.domainId,
            token,
            attached: false,
            ...(platform ? { platform } : {}),
          },
        );
        await ctx.runMutation(
          internal.evidenceLibraries.domains.finishDomainRemoval,
          { domainId: args.domainId, token },
        );
        return { status: "removed" as const };
      }
      // Pressing Remove again carries on from here. The platform's own work
      // has no owner to queue a deployment for, so it leaves the rest to them.
      if (synced === "busy" || platform) return { status: "busy" as const };
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
}

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

const DOMAIN_ACTIVATION_ATTEMPTS = 300;

function domainActivationRetryMs(attempt: number): number {
  return Math.min(5_000 * 2 ** Math.min(attempt, 6), 5 * 60_000);
}

/** Proves every host after its shared deployment and keeps trying while TLS starts. */
export const activateDomains = internalAction({
  args: {
    libraryId: v.id("evidenceLibraries"),
    domainIds: v.array(v.id("evidenceLibraryDomains")),
    attempt: v.number(),
    suspectedTaken: v.optional(v.array(v.id("evidenceLibraryDomains"))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rows = await ctx.runQuery(
      internal.evidenceLibraries.domains.readDomainsForActivation,
      { libraryId: args.libraryId, domainIds: args.domainIds },
    );
    const retry: Id<"evidenceLibraryDomains">[] = [];
    const suspectedTaken = new Set(args.suspectedTaken ?? []);
    const nextSuspectedTaken: Id<"evidenceLibraryDomains">[] = [];
    for (const row of rows) {
      let outcome: DomainOutcome;
      try {
        outcome = await readAnswerGate({
          host: row.host,
          runtimeCommit: row.runtimeCommit,
          liveRevisionKey: row.liveRevisionKey,
          renewLease: async () => undefined,
        });
      } catch (error) {
        if (!isUnavailable(error)) throw error;
        retry.push(row.domainId);
        continue;
      }
      if (outcome.state === "verified") {
        retry.push(row.domainId);
        continue;
      }
      if (
        outcome.state === "failed" &&
        outcome.failure === "host-taken" &&
        !suspectedTaken.has(row.domainId)
      ) {
        retry.push(row.domainId);
        nextSuspectedTaken.push(row.domainId);
        continue;
      }
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
    if (retry.length > 0 && args.attempt + 1 < DOMAIN_ACTIVATION_ATTEMPTS) {
      await ctx.scheduler.runAfter(
        domainActivationRetryMs(args.attempt),
        internal.evidenceLibraries.domainActions.activateDomains,
        {
          libraryId: args.libraryId,
          domainIds: retry,
          attempt: args.attempt + 1,
          ...(nextSuspectedTaken.length > 0
            ? { suspectedTaken: nextSuspectedTaken }
            : {}),
        },
      );
    } else if (retry.length > 0) {
      // ponytail: retry for about 24 hours; use a persistent job only if real
      // certificate issuance regularly exceeds this ceiling.
      for (const domainId of retry) {
        const row = rows.find((entry) => entry.domainId === domainId)!;
        await ctx.runMutation(
          internal.evidenceLibraries.domains.writeSweptDomain,
          {
            domainId,
            expectedGeneration: row.generation,
            state: "failed",
            failure: "tls-timeout",
          },
        );
      }
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
          runtimeCommit: row.runtimeCommit,
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
