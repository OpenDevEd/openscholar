import { internal } from "../_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import { EVIDENCE_LIBRARY_CONFIG_PROVENANCE } from "../../lib/evidence-libraries/configuration/contract";
import {
  readEvidenceLibraryAccess,
  requireEvidenceLibraryAccess,
} from "./access";
import { readEvidenceLibraries } from "./queries";
import { probeEvidenceLibraryAddress } from "./readinessClient";
import {
  fetchRuntimeRelease,
  isFreshRuntimeRelease,
  RuntimeReleaseError,
  runtimeIncludesCommit,
} from "./runtimeReleases";
import {
  evidenceLibraryAddressStateValidator,
  runtimeContractSupportValidator,
  runtimeReleaseChangeValidator,
  runtimeReleaseNotesValidator,
} from "./validators";

const CONTRACT_COMMIT = EVIDENCE_LIBRARY_CONFIG_PROVENANCE.commit;

const runtimeUpdateStateValidator = v.object({
  running: v.string(),
  latest: v.string(),
  latestImage: v.string(),
  changes: v.array(runtimeReleaseChangeValidator),
  releases: v.array(runtimeReleaseNotesValidator),
  checkedAt: v.number(),
  contractSupport: v.optional(runtimeContractSupportValidator),
});

type RuntimeUpdateState = {
  running: string;
  latest: string;
  latestImage: string;
  changes: { sha: string; message: string }[];
  releases: { commit: string; summary: string; notes: string[] }[];
  checkedAt: number;
  contractSupport?: { commit: string; running: boolean; latest: boolean };
};

export const readRunningRelease = internalQuery({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.object({
    running: v.string(),
    bindingId: v.id("evidenceLibraryRuntimeBindings"),
    address: v.string(),
    cached: v.union(v.null(), runtimeUpdateStateValidator),
  }),
  handler: async (ctx, args) => {
    const access = await requireEvidenceLibraryAccess(
      ctx,
      args.libraryId,
      "manage",
    );
    const binding = access.library.runtimeBindingId
      ? await ctx.db.get(access.library.runtimeBindingId)
      : null;
    if (
      !binding ||
      binding.libraryId !== args.libraryId ||
      !("runtimeCommit" in binding)
    ) {
      throw createError("CONFLICT", "This library is not running yet");
    }
    const running = binding.runtimeCommit;
    const cached = await ctx.db
      .query("evidenceLibraryRuntimeReleases")
      .withIndex("by_running", (query) => query.eq("running", running))
      .first();
    return {
      running,
      bindingId: binding._id,
      address: binding.canonicalBaseUrl ?? binding.targetBaseUrl,
      cached:
        cached &&
        typeof cached.latestImage === "string" &&
        cached.releases !== undefined
          ? {
              running,
              latest: cached.latest,
              latestImage: cached.latestImage,
              changes: cached.changes,
              releases: cached.releases,
              checkedAt: cached.checkedAt,
              ...(cached.contractSupport
                ? { contractSupport: cached.contractSupport }
                : {}),
            }
          : null,
    };
  },
});

export const saveRuntimeRelease = internalMutation({
  args: runtimeUpdateStateValidator,
  returns: v.null(),
  handler: async (ctx, args) => {
    // Two cold checks can race here. Reading the first row and patching it
    // keeps the later reads deterministic even if a second row exists.
    const existing = await ctx.db
      .query("evidenceLibraryRuntimeReleases")
      .withIndex("by_running", (query) => query.eq("running", args.running))
      .first();
    if (existing) {
      // Replaced whole, so a contract answer never outlives the release it
      // was about.
      await ctx.db.replace(existing._id, args);
    } else {
      await ctx.db.insert("evidenceLibraryRuntimeReleases", args);
    }
    return null;
  },
});

async function refreshRuntimeRelease(
  ctx: ActionCtx,
  running: string,
  fallback?: RuntimeUpdateState,
): Promise<RuntimeUpdateState> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    // The owner sees a plain message; the setup detail stays in the log.
    console.error("GITHUB_TOKEN is not configured on this deployment");
    throw createError("INVALID_DATA", "Updates cannot be checked right now.");
  }
  let release;
  try {
    release = await fetchRuntimeRelease({ running, token });
  } catch (error) {
    if (error instanceof RuntimeReleaseError) {
      if (error.code === "RUNTIME_IMAGE_UNAVAILABLE" && fallback) {
        const checkedFallback = { ...fallback, checkedAt: Date.now() };
        await ctx.runMutation(
          internal.evidenceLibraries.updates.saveRuntimeRelease,
          checkedFallback,
        );
        return checkedFallback;
      }
      throw createError("INVALID_DATA", error.message, { reason: error.code });
    }
    throw error;
  }
  const contractSupport = await readContractSupport(
    running,
    release.latest,
    token,
  );
  const state = {
    running,
    latest: release.latest,
    latestImage: release.image,
    changes: release.changes,
    releases: release.releases,
    checkedAt: Date.now(),
    ...(contractSupport ? { contractSupport } : {}),
  };
  await ctx.runMutation(
    internal.evidenceLibraries.updates.saveRuntimeRelease,
    state,
  );
  return state;
}

/**
 * Whether the running software, and failing that the latest release, read
 * OpenScholar's configuration contract. Unknown when GitHub cannot say; the
 * update check itself still answers.
 */
async function readContractSupport(
  running: string,
  latest: string,
  token: string,
): Promise<RuntimeUpdateState["contractSupport"]> {
  try {
    const reads = (runtime: string) =>
      runtimeIncludesCommit({ runtime, commit: CONTRACT_COMMIT, token });
    const runningReads = await reads(running);
    return {
      commit: CONTRACT_COMMIT,
      running: runningReads,
      // Only asked when the running software is too old: it names the release
      // a publish would move the library to.
      latest: runningReads || latest === running ? runningReads : await reads(latest),
    };
  } catch (error) {
    if (!(error instanceof RuntimeReleaseError)) throw error;
    console.error("[evidence-library] contract support check failed", {
      code: error.code,
    });
    return undefined;
  }
}

export type PublishRuntime =
  | { kind: "current" }
  | { kind: "unreleased" }
  | {
      kind: "update";
      runtimeUpdate: {
        from: string;
        to: string;
        fromImage: string;
        toImage: string;
      };
    };

/**
 * What a publish needs from the library's software. Software older than
 * OpenScholar's configuration contract refuses the fields it does not know,
 * so the publish moves the library to the latest release in the same step.
 * When the release row has not been checked against this contract, the
 * publish goes ahead on the software the library runs.
 */
export async function readPublishRuntime(
  ctx: QueryCtx,
  library: Doc<"evidenceLibraries">,
): Promise<PublishRuntime> {
  const binding = library.runtimeBindingId
    ? await ctx.db.get("evidenceLibraryRuntimeBindings", library.runtimeBindingId)
    : null;
  if (
    !binding ||
    binding.libraryId !== library._id ||
    binding.state !== "ready"
  ) {
    return { kind: "current" };
  }
  const release = await ctx.db
    .query("evidenceLibraryRuntimeReleases")
    .withIndex("by_running", (query) =>
      query.eq("running", binding.runtimeCommit),
    )
    .first();
  const support = release?.contractSupport;
  if (!release || support?.commit !== CONTRACT_COMMIT || support.running) {
    return { kind: "current" };
  }
  if (!support.latest || release.latest === binding.runtimeCommit) {
    return { kind: "unreleased" };
  }
  return {
    kind: "update",
    runtimeUpdate: {
      from: binding.runtimeCommit,
      to: release.latest,
      fromImage: binding.runtimeImage,
      toImage: release.latestImage,
    },
  };
}

/** For the publish dialog: whether publishing also updates the software. */
export const publishRuntime = query({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.union(
    v.literal("current"),
    v.literal("update"),
    v.literal("unreleased"),
  ),
  handler: async (ctx, args) => {
    const access = await readEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    if (!access || access.library.state !== "active") return "current";
    return (await readPublishRuntime(ctx, access.library)).kind;
  },
});

export const saveAddressState = internalMutation({
  args: {
    bindingId: v.id("evidenceLibraryRuntimeBindings"),
    // The address that was asked. A move can land while the check runs, and
    // an answer about the old address must not be written to the new one.
    askedAddress: v.string(),
    addressState: evidenceLibraryAddressStateValidator,
    checkedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const binding = await ctx.db.get(
      "evidenceLibraryRuntimeBindings",
      args.bindingId,
    );
    if (
      !binding ||
      (binding.canonicalBaseUrl ?? binding.targetBaseUrl) !== args.askedAddress
    ) {
      return null;
    }
    // `updatedAt` stays as it is: a running publish compares it against the
    // binding it started from.
    await ctx.db.patch(args.bindingId, {
      addressState: args.addressState,
      addressCheckedAt: args.checkedAt,
    });
    return null;
  },
});

// Asks one library address who serves it and stores the answer. Runs on its
// own so a dead address never holds up the page.
export const checkAddress = internalAction({
  args: {
    bindingId: v.id("evidenceLibraryRuntimeBindings"),
    address: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const address = await probeEvidenceLibraryAddress({
      targetBaseUrl: args.address,
    });
    await ctx.runMutation(internal.evidenceLibraries.updates.saveAddressState, {
      bindingId: args.bindingId,
      askedAddress: args.address,
      addressState: address.state,
      checkedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Called when the configuration page opens. Answers from the release row when
 * it is under ten minutes old, unless the owner explicitly refreshes. The
 * address check is started here but never waited for; its answer reaches the
 * page through the binding row.
 */
export const check = action({
  args: { libraryId: v.id("evidenceLibraries"), refresh: v.optional(v.boolean()) },
  returns: runtimeUpdateStateValidator,
  handler: async (ctx, args): Promise<RuntimeUpdateState> => {
    const state = await ctx.runQuery(
      internal.evidenceLibraries.updates.readRunningRelease,
      { libraryId: args.libraryId },
    );
    await ctx.scheduler.runAfter(
      0,
      internal.evidenceLibraries.updates.checkAddress,
      { address: state.address, bindingId: state.bindingId },
    );
    // A row checked against another contract, or before contracts were
    // checked, cannot tell a publish what it needs, so GitHub is asked again.
    // So is one where no release reads the contract yet: the owner was told
    // to try again in a few minutes, and the release may be out by then.
    const support = state.cached?.contractSupport;
    if (
      !args.refresh &&
      state.cached &&
      isFreshRuntimeRelease(state.cached.checkedAt, Date.now()) &&
      support?.commit === CONTRACT_COMMIT &&
      (support.running || support.latest)
    ) {
      return state.cached;
    }
    return await refreshRuntimeRelease(
      ctx,
      state.running,
      state.cached ?? undefined,
    );
  },
});

/**
 * What the pages have to say about addresses. A library that is still setting
 * up reports the address it came from, so the owner sees why the address next
 * to it is not the one they reserved. A live library reports the address it
 * runs on and who last answered there, when that was not this library.
 */
export const listAddressNotices = query({
  args: {},
  returns: v.array(
    v.object({
      libraryId: v.id("evidenceLibraries"),
      address: v.string(),
      movedFrom: v.union(v.string(), v.null()),
      addressState: v.union(evidenceLibraryAddressStateValidator, v.null()),
    }),
  ),
  handler: async (ctx) => {
    const libraries = await readEvidenceLibraries(ctx);
    const notices = await Promise.all(
      libraries.map(async (library) => {
        const binding = library.runtimeBindingId
          ? await ctx.db.get(
              "evidenceLibraryRuntimeBindings",
              library.runtimeBindingId,
            )
          : null;
        const address =
          binding?.canonicalBaseUrl ?? binding?.targetBaseUrl ?? "";
        if (library.state === "active") {
          const addressState = binding?.addressState;
          return addressState && addressState !== "ours"
            ? { libraryId: library._id, address, movedFrom: null, addressState }
            : null;
        }
        if (!library.setupOperationId) return null;
        const operation = await ctx.db.get(
          "evidenceLibraryConfigOperations",
          library.setupOperationId,
        );
        const movedFrom = operation?.addressMove?.from;
        return movedFrom
          ? { libraryId: library._id, address, movedFrom, addressState: null }
          : null;
      }),
    );
    return notices.filter((notice) => notice !== null);
  },
});

// Maintenance entry point: refresh the release row for one running commit
// without a signed-in owner (used to check a deployment from the CLI).
export const refresh = internalAction({
  args: { running: v.string() },
  returns: runtimeUpdateStateValidator,
  handler: async (ctx, args): Promise<RuntimeUpdateState> =>
    await refreshRuntimeRelease(ctx, args.running),
});
