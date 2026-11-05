/**
 * Community releases (Settings, Community releases): which new-el releases this deployment offers, and
 * moving communities onto the newest one, one at a time, smallest first, stopping at the first failure.
 * Updates only go forward. Going back is done by hand on the server.
 *
 * A rollout lives on the server, so it goes on with the page closed and only one can run: simultaneous
 * updates killed deployments (2026-10-10).
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "../lib/functions";
import { requireAdmin } from "../admins/access";
import { createError, readConvexErrorData } from "../lib/errors";
import { MAX_RELEASES, MAX_RELEASE_NOTES, MAX_ROLLOUT_COMMUNITIES } from "../lib/listCaps";
import { newestOffered, releasesBehind } from "../../lib/evidence-libraries/runtime-position";
import { resolveRuntimeImage } from "./runtimeImageRegistry";
import { fetchRuntimeCatalog, offersPrereleases, RELEASE_CHECK_WITHDRAWN, runtimeIncludesCommit, setRuntimeReleasePrerelease } from "./runtimeReleases";
import { releaseCatalogRowsValidator, releasesOverviewValidator } from "./validators";
import { startRolloutRuntimeUpdate } from "./versions";

/** How often a rollout looks at the update it's waiting on. */
const POLL_MS = 10_000;
/** Commits communities run, each with a saved update check to mark stale. */
const SAVED_CHECKS_READ = MAX_ROLLOUT_COMMUNITIES;

const githubToken = () => {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) throw createError("INVALID_DATA", "GITHUB_TOKEN is not configured on this deployment");
  return token;
};

const readCatalog = (ctx: QueryCtx) =>
  ctx.db.query("evidenceLibraryReleaseCatalog").withIndex("by_publishedAt").order("desc").take(MAX_RELEASES);

/** Every live community, smallest first, with the release it runs. */
async function readCommunities(ctx: QueryCtx) {
  const libraries = await ctx.db.query("evidenceLibraries").take(MAX_ROLLOUT_COMMUNITIES + 1);
  if (libraries.length > MAX_ROLLOUT_COMMUNITIES) {
    throw createError("CONFLICT", `There are more than ${MAX_ROLLOUT_COMMUNITIES} communities, too many to list here`);
  }
  const communities = await Promise.all(
    libraries.filter((library) => library.state === "active" && library.runtimeBindingId).map((library) => readCommunity(ctx, library)),
  );
  return communities.filter((community) => community !== null).sort((a, b) => a.records - b.records);
}

async function readCommunity(ctx: QueryCtx, library: Doc<"evidenceLibraries">) {
  const binding = await ctx.db.get("evidenceLibraryRuntimeBindings", library.runtimeBindingId!);
  if (!binding || !("runtimeCommit" in binding)) return null;
  const status = await ctx.db.query("evidenceLibrarySourceStatus").withIndex("by_libraryId", (q) => q.eq("libraryId", library._id)).first();
  const records = (status?.sources ?? []).reduce((sum, source) => sum + (source.searchable ?? 0), 0);
  return { id: library._id, name: library.name, running: binding.runtimeCommit, records, address: binding.canonicalBaseUrl ?? binding.targetBaseUrl };
}

const currentRollout = (ctx: QueryCtx) => ctx.db.query("evidenceLibraryRollouts").first();
const isBusy = (rollout: Doc<"evidenceLibraryRollouts"> | null) => rollout?.state === "running" || rollout?.state === "failed";

/** Everything the page shows. */
export const overview = query({
  args: {},
  returns: releasesOverviewValidator,
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const catalog = await readCatalog(ctx);
    const rollout = await currentRollout(ctx);
    const operation = rollout?.operationId ? await ctx.db.get("evidenceLibraryConfigOperations", rollout.operationId) : null;
    return {
      releases: catalog.map(({ commit, publishedAt, prerelease, summary, notes, databaseChanges }) => ({
        commit,
        publishedAt,
        prerelease,
        summary,
        notes,
        ...(databaseChanges === undefined ? {} : { databaseChanges }),
      })),
      latest: newestOffered(catalog, offersPrereleases())?.commit ?? null,
      communities: await readCommunities(ctx),
      rollout: rollout && {
        target: rollout.target,
        queue: rollout.queue,
        done: rollout.done,
        skipped: rollout.skipped,
        state: rollout.state,
        stopping: rollout.stopping,
        ...(rollout.failure === undefined ? {} : { failure: rollout.failure }),
        stage: operation?.stage ?? null,
      },
    };
  },
});

/** A saved update check names the newest release as it stood, so none is used until it's read again. */
async function withdrawSavedChecks(ctx: MutationCtx) {
  for (const check of await ctx.db.query("evidenceLibraryRuntimeReleases").take(SAVED_CHECKS_READ)) {
    await ctx.db.patch("evidenceLibraryRuntimeReleases", check._id, { checkedAt: RELEASE_CHECK_WITHDRAWN });
  }
}

export const saveCatalog = internalMutation({
  args: { rows: releaseCatalogRowsValidator },
  returns: v.null(),
  handler: async (ctx, { rows }) => {
    const held = await ctx.db.query("evidenceLibraryReleaseCatalog").take(MAX_RELEASES * 2);
    const listed = new Set(rows.map((row) => row.commit));
    // Promoted or pulled back from another deployment.
    const channels = new Map(held.map((row) => [row.commit, row.prerelease]));
    if (rows.some((row) => channels.has(row.commit) && channels.get(row.commit) !== row.prerelease)) await withdrawSavedChecks(ctx);
    // Fallen off GitHub's page, so the page can't place it either.
    for (const row of held) if (!listed.has(row.commit)) await ctx.db.delete("evidenceLibraryReleaseCatalog", row._id);
    const byCommit = new Map(held.map((row) => [row.commit, row]));
    for (const row of rows) {
      const existing = byCommit.get(row.commit);
      if (existing) await ctx.db.replace("evidenceLibraryReleaseCatalog", existing._id, row);
      else await ctx.db.insert("evidenceLibraryReleaseCatalog", row);
    }
    return null;
  },
});

/** Reads the releases from GitHub. A failed run waits for the next tick, and the page keeps what it has. */
export const syncCatalog = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const published = await fetchRuntimeCatalog({ token: githubToken() });
    await ctx.runMutation(internal.evidenceLibraries.releases.saveCatalog, {
      rows: published.slice(0, MAX_RELEASES).map(({ releaseId, publishedAt, prerelease, databaseChanges, release }) => ({
        commit: release.commit,
        releaseId,
        publishedAt,
        prerelease,
        summary: release.summary,
        notes: release.notes.slice(0, MAX_RELEASE_NOTES),
        ...(databaseChanges === undefined ? {} : { databaseChanges }),
      })),
    });
    return null;
  },
});

export const readForChange = internalQuery({
  args: { commit: v.string() },
  returns: v.number(),
  handler: async (ctx, { commit }) => {
    await requireAdmin(ctx);
    const row = await ctx.db.query("evidenceLibraryReleaseCatalog").withIndex("by_commit", (q) => q.eq("commit", commit)).first();
    if (!row) throw createError("NOT_FOUND", "That release isn't listed any more");
    return row.releaseId;
  },
});

export const recordChannel = internalMutation({
  args: { commit: v.string(), prerelease: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { commit, prerelease }) => {
    const row = await ctx.db.query("evidenceLibraryReleaseCatalog").withIndex("by_commit", (q) => q.eq("commit", commit)).first();
    if (row) await ctx.db.patch("evidenceLibraryReleaseCatalog", row._id, { prerelease });
    await withdrawSavedChecks(ctx);
    return null;
  },
});

/** Promotes a release, or pulls one back. */
export const setChannel = action({
  args: { commit: v.string(), prerelease: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { commit, prerelease }): Promise<null> => {
    const releaseId: number = await ctx.runQuery(internal.evidenceLibraries.releases.readForChange, { commit });
    await setRuntimeReleasePrerelease({ token: githubToken(), releaseId, prerelease });
    await ctx.runMutation(internal.evidenceLibraries.releases.recordChannel, { commit, prerelease });
    return null;
  },
});

export const readRolloutTarget = internalQuery({
  args: {},
  returns: v.object({ target: v.string(), startedByClerkUserId: v.string() }),
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const latest = newestOffered(await readCatalog(ctx), offersPrereleases());
    if (!latest) throw createError("CONFLICT", "No release is offered yet");
    return { target: latest.commit, startedByClerkUserId: admin.clerkId };
  },
});

export const createRollout = internalMutation({
  args: { target: v.string(), targetImage: v.string(), startedByClerkUserId: v.string(), libraryId: v.optional(v.id("evidenceLibraries")) },
  returns: v.null(),
  handler: async (ctx, { libraryId, ...rollout }) => {
    const previous = await currentRollout(ctx);
    if (isBusy(previous)) throw createError("CONFLICT", "An update is already running");
    const catalog = await readCatalog(ctx);
    const queue = (await readCommunities(ctx))
      .filter((community) => (libraryId === undefined || community.id === libraryId) && releasesBehind(community.running, rollout.target, catalog) > 0)
      .map((community) => community.id);
    if (queue.length === 0) throw createError("CONFLICT", "Nothing is behind that release");
    if (previous) await ctx.db.delete("evidenceLibraryRollouts", previous._id);
    const rolloutId = await ctx.db.insert("evidenceLibraryRollouts", { ...rollout, queue, done: 0, skipped: 0, state: "running", stopping: false });
    await ctx.scheduler.runAfter(0, internal.evidenceLibraries.releases.advance, { rolloutId });
    return null;
  },
});

/** Starts moving every community that's behind onto the newest release offered, or just one of them. */
export const startRollout = action({
  args: { libraryId: v.optional(v.id("evidenceLibraries")) },
  returns: v.null(),
  handler: async (ctx, { libraryId }): Promise<null> => {
    const { target, startedByClerkUserId }: { target: string; startedByClerkUserId: string } = await ctx.runQuery(internal.evidenceLibraries.releases.readRolloutTarget, {});
    const targetImage = await resolveRuntimeImage({ commit: target, githubToken: githubToken() });
    if (!targetImage) throw createError("CONFLICT", "That release's software image could not be read right now");
    await ctx.runMutation(internal.evidenceLibraries.releases.createRollout, { target, targetImage, startedByClerkUserId, ...(libraryId ? { libraryId } : {}) });
    return null;
  },
});

async function finishCommunity(ctx: MutationCtx, rollout: Doc<"evidenceLibraryRollouts">) {
  const done = rollout.done + 1;
  const finished = done >= rollout.queue.length;
  await ctx.db.patch("evidenceLibraryRollouts", rollout._id, {
    done,
    operationId: undefined,
    failure: undefined,
    state: finished ? "finished" : rollout.stopping ? "stopped" : "running",
  });
  if (!finished && !rollout.stopping) await ctx.scheduler.runAfter(0, internal.evidenceLibraries.releases.advance, { rolloutId: rollout._id });
}

/** One step: looks at the update under way, or starts the next. */
export const advance = internalMutation({
  args: { rolloutId: v.id("evidenceLibraryRollouts") },
  returns: v.null(),
  handler: async (ctx, { rolloutId }) => {
    const rollout = await ctx.db.get("evidenceLibraryRollouts", rolloutId);
    if (rollout?.state !== "running") return null;
    if (!rollout.operationId) {
      await ctx.scheduler.runAfter(0, internal.evidenceLibraries.releases.startCommunity, { rolloutId });
      return null;
    }
    const operation = await ctx.db.get("evidenceLibraryConfigOperations", rollout.operationId);
    if (operation?.status === "succeeded") await finishCommunity(ctx, rollout);
    else if (!operation || operation.status === "failed") {
      await ctx.db.patch("evidenceLibraryRollouts", rolloutId, { state: "failed", failure: operation?.error?.message ?? "The update stopped without saying why" });
    } else await ctx.scheduler.runAfter(POLL_MS, internal.evidenceLibraries.releases.advance, { rolloutId });
    return null;
  },
});

/** The commit the community a rollout has reached runs, for asking GitHub where it stands. */
export const readRolloutCommunity = internalQuery({
  args: { rolloutId: v.id("evidenceLibraryRollouts") },
  returns: v.union(v.null(), v.object({ target: v.string(), running: v.union(v.string(), v.null()) })),
  handler: async (ctx, { rolloutId }) => {
    const rollout = await ctx.db.get("evidenceLibraryRollouts", rolloutId);
    if (rollout?.state !== "running" || rollout.operationId) return null;
    const library = await ctx.db.get("evidenceLibraries", rollout.queue[rollout.done]!);
    const community = library?.state === "active" && library.runtimeBindingId ? await readCommunity(ctx, library) : null;
    return { target: rollout.target, running: community?.running ?? null };
  },
});

export const beginCommunity = internalMutation({
  args: {
    rolloutId: v.id("evidenceLibraryRollouts"),
    // What GitHub was asked about: whether `running` already holds the target.
    running: v.union(v.string(), v.null()),
    reached: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, { rolloutId, running, reached }) => {
    const rollout = await ctx.db.get("evidenceLibraryRollouts", rolloutId);
    if (rollout?.state !== "running" || rollout.operationId) return null;
    const library = await ctx.db.get("evidenceLibraries", rollout.queue[rollout.done]!);
    const community = library?.state === "active" && library.runtimeBindingId ? await readCommunity(ctx, library) : null;
    // Gone, or moved on by itself since the rollout began.
    if (!library || !community || reached) {
      await finishCommunity(ctx, rollout);
      return null;
    }
    // Updates only go forward, so the answer has to be about the commit it runs now.
    if (community.running !== running) throw createError("CONFLICT", "This community's software changed as the update started");
    const target = await ctx.db.query("evidenceLibraryReleaseCatalog").withIndex("by_commit", (q) => q.eq("commit", rollout.target)).first();
    if (!target || (target.prerelease && !offersPrereleases())) throw createError("CONFLICT", "That release was pulled back");
    const operationId = await startRolloutRuntimeUpdate(ctx, {
      library,
      to: rollout.target,
      toImage: rollout.targetImage,
      requestedByClerkUserId: rollout.startedByClerkUserId,
    });
    await ctx.db.patch("evidenceLibraryRollouts", rolloutId, { operationId });
    await ctx.scheduler.runAfter(POLL_MS, internal.evidenceLibraries.releases.advance, { rolloutId });
    return null;
  },
});

export const recordFailure = internalMutation({
  args: { rolloutId: v.id("evidenceLibraryRollouts"), failure: v.string() },
  returns: v.null(),
  handler: async (ctx, { rolloutId, failure }) => {
    await ctx.db.patch("evidenceLibraryRollouts", rolloutId, { state: "failed", failure });
    return null;
  },
});

/** Runs on its own so a refusal rolls back whatever it had started, and is then written down. */
export const startCommunity = internalAction({
  args: { rolloutId: v.id("evidenceLibraryRollouts") },
  returns: v.null(),
  handler: async (ctx, { rolloutId }) => {
    try {
      const current = await ctx.runQuery(internal.evidenceLibraries.releases.readRolloutCommunity, { rolloutId });
      if (!current) return null;
      // Asked of GitHub, not the release list: an owner's update can be on a release the list hasn't heard of.
      const reached = current.running !== null && (await runtimeIncludesCommit({ runtime: current.running, commit: current.target, token: githubToken() }));
      await ctx.runMutation(internal.evidenceLibraries.releases.beginCommunity, { rolloutId, running: current.running, reached });
    } catch (error) {
      console.error("[evidence-library] a rollout could not start a community", { rolloutId, error: String(error) });
      await ctx.runMutation(internal.evidenceLibraries.releases.recordFailure, {
        rolloutId,
        // Only site admins read this, so a plain error's own first line beats a vague one.
        failure: readConvexErrorData(error)?.message ?? String(error).split("\n", 1)[0]!.slice(0, 300),
      });
    }
    return null;
  },
});

/** The buttons on the rollout: stop after this one, skip the failed one, try it again, stop, or put the finished one away. */
export const steerRollout = mutation({
  args: { action: v.union(v.literal("stopAfterThis"), v.literal("skip"), v.literal("retry"), v.literal("stop"), v.literal("dismiss")) },
  returns: v.null(),
  handler: async (ctx, { action: steer }) => {
    await requireAdmin(ctx);
    const rollout = await currentRollout(ctx);
    if (!rollout) return null;
    const id: Id<"evidenceLibraryRollouts"> = rollout._id;
    if (steer === "dismiss") {
      if (isBusy(rollout)) throw createError("CONFLICT", "This update is still going");
      await ctx.db.delete("evidenceLibraryRollouts", id);
    } else if (steer === "stopAfterThis") {
      if (rollout.state === "running") await ctx.db.patch("evidenceLibraryRollouts", id, { stopping: true });
    } else if (rollout.state !== "failed") {
      throw createError("CONFLICT", "This update hasn't stopped at a failure");
    } else if (steer === "stop") {
      await ctx.db.patch("evidenceLibraryRollouts", id, { state: "stopped", operationId: undefined, failure: undefined });
    } else if (steer === "skip") {
      await ctx.db.patch("evidenceLibraryRollouts", id, { skipped: rollout.skipped + 1 });
      await finishCommunity(ctx, { ...rollout, stopping: false });
    } else {
      await ctx.db.patch("evidenceLibraryRollouts", id, { state: "running", operationId: undefined, failure: undefined, stopping: false });
      await ctx.scheduler.runAfter(0, internal.evidenceLibraries.releases.advance, { rolloutId: id });
    }
    return null;
  },
});
