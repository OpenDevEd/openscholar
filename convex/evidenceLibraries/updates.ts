import { internal } from "../_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
} from "../_generated/server";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import { requireEvidenceLibraryAccess } from "./access";
import { readEvidenceLibraries } from "./queries";
import {
  probeEvidenceLibraryAddress,
  type EvidenceLibraryAddressState,
} from "./readinessClient";
import { evidenceLibraryAddressStateValidator } from "./validators";
import {
  fetchRuntimeRelease,
  isFreshRuntimeRelease,
  RuntimeReleaseError,
} from "./runtimeReleases";
import { runtimeReleaseChangeValidator } from "./validators";

const runtimeUpdateStateValidator = v.object({
  running: v.string(),
  latest: v.string(),
  changes: v.array(runtimeReleaseChangeValidator),
  checkedAt: v.number(),
});

// What the configuration page reads when it opens: the software the library
// runs, and who answers its public address.
const libraryCheckValidator = v.object({
  running: v.string(),
  latest: v.string(),
  changes: v.array(runtimeReleaseChangeValidator),
  checkedAt: v.number(),
  addressState: evidenceLibraryAddressStateValidator,
});

type RuntimeUpdateState = {
  running: string;
  latest: string;
  changes: { sha: string; message: string }[];
  checkedAt: number;
};

type LibraryCheckState = RuntimeUpdateState & {
  addressState: EvidenceLibraryAddressState;
};

export const readRunningRelease = internalQuery({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.object({
    running: v.string(),
    bindingId: v.id("evidenceLibraryRuntimeBindings"),
    targetBaseUrl: v.string(),
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
      targetBaseUrl: binding.targetBaseUrl,
      cached:
        cached && isFreshRuntimeRelease(cached.checkedAt, Date.now())
          ? {
              running,
              latest: cached.latest,
              changes: cached.changes,
              checkedAt: cached.checkedAt,
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
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert("evidenceLibraryRuntimeReleases", args);
    }
    return null;
  },
});

async function refreshRuntimeRelease(
  ctx: ActionCtx,
  running: string,
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
      throw createError("INVALID_DATA", error.message, { reason: error.code });
    }
    throw error;
  }
  const state = {
    running,
    latest: release.latest,
    changes: release.changes,
    checkedAt: Date.now(),
  };
  await ctx.runMutation(
    internal.evidenceLibraries.updates.saveRuntimeRelease,
    state,
  );
  return state;
}

export const saveAddressState = internalMutation({
  args: {
    bindingId: v.id("evidenceLibraryRuntimeBindings"),
    addressState: evidenceLibraryAddressStateValidator,
    checkedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // `updatedAt` stays as it is: a running publish compares it against the
    // binding it started from.
    await ctx.db.patch(args.bindingId, {
      addressState: args.addressState,
      addressCheckedAt: args.checkedAt,
    });
    return null;
  },
});

/**
 * Called when the configuration page opens. The software answer comes from
 * the release row while it is under ten minutes old; the address is asked
 * every time, because an address can be taken over at any moment.
 */
export const check = action({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: libraryCheckValidator,
  handler: async (ctx, args): Promise<LibraryCheckState> => {
    const state = await ctx.runQuery(
      internal.evidenceLibraries.updates.readRunningRelease,
      args,
    );
    const address = await probeEvidenceLibraryAddress({
      targetBaseUrl: state.targetBaseUrl,
    });
    await ctx.runMutation(
      internal.evidenceLibraries.updates.saveAddressState,
      {
        bindingId: state.bindingId,
        addressState: address.state,
        checkedAt: Date.now(),
      },
    );
    const release =
      state.cached ?? (await refreshRuntimeRelease(ctx, state.running));
    return { ...release, addressState: address.state };
  },
});

/**
 * What the library list has to say about addresses. A library that is still
 * setting up reports the address the platform moved it to, so the owner sees
 * why it is not the one they reserved. A live library reports its address
 * only when the last check found somebody else there, or nobody at all.
 */
export const listAddressNotices = query({
  args: {},
  returns: v.array(
    v.object({
      libraryId: v.id("evidenceLibraries"),
      movedTo: v.union(v.string(), v.null()),
      addressState: v.union(evidenceLibraryAddressStateValidator, v.null()),
    }),
  ),
  handler: async (ctx) => {
    const libraries = await readEvidenceLibraries(ctx);
    const notices = await Promise.all(
      libraries.map(async (library) => {
        if (library.state === "active") {
          const binding = library.runtimeBindingId
            ? await ctx.db.get(
                "evidenceLibraryRuntimeBindings",
                library.runtimeBindingId,
              )
            : null;
          const addressState = binding?.addressState;
          return addressState && addressState !== "ours"
            ? { libraryId: library._id, movedTo: null, addressState }
            : null;
        }
        if (!library.setupOperationId) return null;
        const operation = await ctx.db.get(
          "evidenceLibraryConfigOperations",
          library.setupOperationId,
        );
        const movedTo = operation?.addressMove?.to;
        return movedTo
          ? { libraryId: library._id, movedTo, addressState: null }
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
