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
  classifyTarget,
  classifyToken,
  DnsLookupError,
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

type CheckDomainResult = {
  status: "checked";
  state: "added" | "pointing" | "verified" | "active" | "failed";
  failure?: DomainFailure;
  certificateState?: CertificateState;
};

const checkedValidator = v.object({
  status: v.literal("checked"),
  state: evidenceLibraryDomainStateValidator,
  failure: v.optional(evidenceLibraryDomainFailureValidator),
  certificateState: v.optional(evidenceLibraryCertificateStateValidator),
});

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
  const targetAddresses = readAgreedAnswer(
    await lookupHost(fetch, target, "A"),
    (answer) => answer.addresses.slice().sort().join(","),
  ).split(",").filter(Boolean);
  const targetReading = readAgreedAnswer(targetAnswers, (answer) =>
    classifyTarget(answer, { target, targetAddresses }),
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
          answer.caaIssuers.slice().sort().join(","),
        )
          .split(",")
          .filter(Boolean),
      );
    }
    caa = classifyCaaChain(chain);
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
  },
): Promise<DomainOutcome & { certificateState?: CertificateState }> {
  const cloudflare = createPlatformCloudflareSaasClient();
  if (!cloudflare) return { state: "failed", failure: "check-failed" };
  const hostname =
    (await cloudflare.readCustomHostname(input.host)) ??
    (await cloudflare.createCustomHostname({
      host: input.host,
      // The library's own platform address answers the request, so the
      // runtime serves the certificate it already has and never asks for
      // one in the customer's name.
      originHost: new URL(input.platformAddress).hostname,
    }));
  try {
    await coolify().setCustomDomains({
      applicationUuid: input.applicationUuid,
      libraryId: input.libraryId,
      publicDomain: input.platformAddress,
      customDomains: [...input.attachedHosts, `https://${input.host}`],
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
  await ctx.runMutation(internal.evidenceLibraries.versions.startDomainDeployment, {
    libraryId: input.libraryId,
    host: input.host,
    reason: "attach",
  });
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
 */
export const checkDomain = action({
  args: {
    libraryId: v.id("evidenceLibraries"),
    domainId: v.id("evidenceLibraryDomains"),
  },
  returns: checkedValidator,
  handler: async (ctx, args): Promise<CheckDomainResult> => {
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
      // domain: the owner is asked to try again.
      if (error instanceof DnsLookupError || error instanceof CoolifyClientError) {
        outcome = { state: "failed", failure: "check-failed" };
      } else {
        throw error;
      }
    }

    const failure: DomainFailure | undefined =
      outcome.state === "failed" ? outcome.failure : undefined;
    await ctx.runMutation(internal.evidenceLibraries.domains.writeDomainCheck, {
      libraryId: args.libraryId,
      domainId: args.domainId,
      state: outcome.state,
      ...(failure ? { failure } : {}),
      ...(outcome.certificateState
        ? { certificateState: outcome.certificateState }
        : {}),
    });
    return {
      status: "checked" as const,
      state: outcome.state,
      ...(failure ? { failure } : {}),
      ...(outcome.certificateState
        ? { certificateState: outcome.certificateState }
        : {}),
    };
  },
});

/**
 * Takes the domain off the library. The proxy loses it first, then the
 * certificate service, then the row. The platform address is never touched.
 */
export const removeDomain = action({
  args: {
    libraryId: v.id("evidenceLibraries"),
    domainId: v.id("evidenceLibraryDomains"),
  },
  returns: v.object({ status: v.literal("removed") }),
  handler: async (ctx, args): Promise<{ status: "removed" }> => {
    const context = await ctx.runQuery(
      internal.evidenceLibraries.domains.readDomainContext,
      { libraryId: args.libraryId, domainId: args.domainId },
    );
    const row = context.domain;
    if (!row) return { status: "removed" as const };
    if (row.attached && context.applicationUuid) {
      await coolify().setCustomDomains({
        applicationUuid: context.applicationUuid,
        libraryId: args.libraryId,
        publicDomain: context.platformAddress,
        customDomains: context.attachedHosts.filter(
          (entry: string) => entry !== `https://${row.host}`,
        ),
      });
      await ctx.runMutation(
        internal.evidenceLibraries.domains.writeDomainAttachment,
        { libraryId: args.libraryId, domainId: args.domainId, attached: false },
      );
    }
    const cloudflare = createPlatformCloudflareSaasClient();
    if (cloudflare && row.certificateHostnameId) {
      await cloudflare.deleteCustomHostname(row.certificateHostnameId);
    }
    await ctx.runMutation(internal.evidenceLibraries.domains.dropDomain, {
      libraryId: args.libraryId,
      domainId: args.domainId,
    });
    if (row.attached && context.applicationUuid) {
      await ctx.runMutation(
        internal.evidenceLibraries.versions.startDomainDeployment,
        { libraryId: args.libraryId, host: row.host, reason: "detach" },
      );
    }
    return { status: "removed" as const };
  },
});

/** How many working domains one sweep re-checks. */
const SWEEP_BATCH = 20;

/**
 * Re-checks the domains the platform says are working. A customer who points
 * their domain somewhere else should stop showing as working, rather than
 * leaving a route open for ever. Nothing else changes: the proxy and the
 * certificate stay until an owner removes the domain.
 */
export const sweepWorkingDomains = internalAction({
  args: {},
  returns: v.object({ checked: v.number(), failed: v.number() }),
  handler: async (ctx): Promise<{ checked: number; failed: number }> => {
    const rows = await ctx.runQuery(
      internal.evidenceLibraries.domains.listWorkingDomains,
      { limit: SWEEP_BATCH },
    );
    let failed = 0;
    for (const row of rows) {
      let outcome: DomainOutcome & { certificateState?: CertificateState };
      try {
        outcome = await readAnswerGate({
          host: row.host,
          liveRevisionKey: row.liveRevisionKey,
        });
      } catch {
        // A sweep that could not run leaves the row exactly as it was.
        continue;
      }
      if (outcome.state === "active") continue;
      failed += 1;
      await ctx.runMutation(
        internal.evidenceLibraries.domains.writeSweptDomain,
        {
          domainId: row.domainId,
          state: outcome.state === "failed" ? "failed" : outcome.state,
          ...(outcome.state === "failed" ? { failure: outcome.failure } : {}),
          ...(outcome.certificateState
            ? { certificateState: outcome.certificateState }
            : {}),
        },
      );
    }
    return { checked: rows.length, failed };
  },
});
