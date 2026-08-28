"use node";

import { v } from "convex/values";
import { action, type ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { createCoolifyClient } from "./coolifyClient";
import { evidenceLibrarySetupIdentityFields } from "./validators";

const PROBE_TIMEOUT_MS = 8_000;
// How long the list of hosts Coolify serves may be reused.
const SERVED_HOSTS_MAX_AGE_MS = 60_000;
const FREE_HOST_STATUS = 503;
const FREE_HOST_BODY = "no available server";
const MAX_PROBE_BODY_BYTES = 4 * 1024;

type AddressIdentity = {
  name: string;
  publicAddress: string;
  shortName: string;
  slug: string;
};

type AddressCheckResult =
  | ({ status: "available" } & AddressIdentity)
  | { status: "name-taken"; libraryId: Id<"evidenceLibraries"> }
  | { status: "unavailable"; reason: "check-failed" | "no-address" };

type AddressReservationResult =
  | ({ status: "reserved"; libraryId: Id<"evidenceLibraries"> } & AddressIdentity)
  | { status: "address-taken" }
  | Exclude<AddressCheckResult, { status: "available" }>;

const nameTakenValidator = v.object({
  status: v.literal("name-taken"),
  libraryId: v.id("evidenceLibraries"),
});

const unavailableValidator = v.object({
  status: v.literal("unavailable"),
  reason: v.union(v.literal("check-failed"), v.literal("no-address")),
});

const addressCheckValidator = v.union(
  v.object({
    status: v.literal("available"),
    ...evidenceLibrarySetupIdentityFields,
  }),
  nameTakenValidator,
  unavailableValidator,
);

// Raised when a check could not run. Nothing is ever reserved after one of
// these: the owner is asked to try again.
class AddressCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AddressCheckError";
  }
}

/**
 * Our proxy answers `503 no available server` for a host nothing serves.
 * Every other answer means something is already there.
 */
export function isFreeHostSignal(status: number, body: string): boolean {
  return (
    status === FREE_HOST_STATUS &&
    body.trimStart().toLowerCase().startsWith(FREE_HOST_BODY)
  );
}

async function readProbeBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (bytes < MAX_PROBE_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    chunks.push(value);
  }
  await reader.cancel().catch(() => undefined);
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}

/**
 * Asks the host itself whether anything answers there. A network failure or
 * a timeout is not an answer, so it throws instead of guessing.
 */
async function probeAddress(publicAddress: string): Promise<"free" | "served"> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(new URL("/", publicAddress), {
        method: "GET",
        redirect: "manual",
        headers: { accept: "*/*" },
        signal: controller.signal,
      });
    } catch {
      throw new AddressCheckError("The address could not be checked");
    }
    if (response.status !== FREE_HOST_STATUS) {
      await response.body?.cancel().catch(() => undefined);
      return "served";
    }
    return isFreeHostSignal(response.status, await readProbeBody(response))
      ? "free"
      : "served";
  } finally {
    clearTimeout(timeout);
  }
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new AddressCheckError(`${name} is not configured`);
  return value;
}

/**
 * The hosts Coolify serves, kept for a minute so a burst of checks and the
 * reservation that follows cost one pair of Coolify reads. A list older than
 * that is refused unless Coolify answers again.
 */
export async function readServedHosts(ctx: ActionCtx): Promise<Set<string>> {
  const cached = await ctx.runQuery(
    internal.evidenceLibraries.queries.readServedHostsCache,
    {},
  );
  if (cached && Date.now() - cached.fetchedAt < SERVED_HOSTS_MAX_AGE_MS) {
    return new Set(cached.hosts);
  }
  const hosts = await createCoolifyClient({
    origin: requireEnvironment("EL_COOLIFY_URL"),
    token: requireEnvironment("EL_COOLIFY_TOKEN"),
  }).listServedHosts();
  await ctx.runMutation(
    internal.evidenceLibraries.mutations.writeServedHostsCache,
    { hosts: [...hosts] },
  );
  return hosts;
}

/**
 * The first candidate nothing else holds: not served by Coolify and not
 * answering on the host itself. Returns null when every candidate is taken.
 * Throws when a check could not run, so nothing is ever taken blindly.
 * Shared by the new-library page and by address recovery.
 */
export async function findFreeEvidenceLibraryAddress(
  ctx: ActionCtx,
  candidates: readonly { publicAddress: string; slug: string }[],
): Promise<{ publicAddress: string; slug: string } | null> {
  const servedHosts = await readServedHosts(ctx);
  for (const candidate of candidates) {
    const host = new URL(candidate.publicAddress).hostname.toLowerCase();
    if (servedHosts.has(host)) continue;
    if ((await probeAddress(candidate.publicAddress)) === "free") {
      return candidate;
    }
  }
  return null;
}

async function checkEvidenceLibraryAddress(
  ctx: ActionCtx,
  args: { name: string },
): Promise<AddressCheckResult> {
  const state = await ctx.runQuery(
    internal.evidenceLibraries.queries.readAddressCandidates,
    { name: args.name },
  );
  if (state.status === "name-taken") return state;

  let free: { publicAddress: string; slug: string } | null;
  try {
    free = await findFreeEvidenceLibraryAddress(ctx, state.candidates);
  } catch {
    return { status: "unavailable", reason: "check-failed" };
  }
  if (free) {
    return {
      status: "available",
      name: state.name,
      publicAddress: free.publicAddress,
      shortName: state.shortName,
      slug: free.slug,
    };
  }

  return { status: "unavailable", reason: "no-address" };
}

/**
 * One answer for "what address would this name get?": the name is free and
 * this address is free everywhere we can look, the organisation already has
 * a library with this name, or the check could not run.
 */
export const checkAddress = action({
  args: { name: v.string() },
  returns: addressCheckValidator,
  handler: async (ctx, args): Promise<AddressCheckResult> =>
    await checkEvidenceLibraryAddress(ctx, { name: args.name }),
});

/**
 * Runs the same check and keeps the address it found, in one transaction.
 */
export const reserveAddress = action({
  args: { name: v.string() },
  returns: v.union(
    v.object({
      status: v.literal("reserved"),
      libraryId: v.id("evidenceLibraries"),
      ...evidenceLibrarySetupIdentityFields,
    }),
    v.object({ status: v.literal("address-taken") }),
    nameTakenValidator,
    unavailableValidator,
  ),
  handler: async (ctx, args): Promise<AddressReservationResult> => {
    const checked = await checkEvidenceLibraryAddress(ctx, { name: args.name });
    if (checked.status !== "available") return checked;
    const reserved = await ctx.runMutation(
      internal.evidenceLibraries.mutations.reserveAddress,
      {
        name: checked.name,
        publicAddress: checked.publicAddress,
        slug: checked.slug,
      },
    );
    // Someone took the address between the check and the write.
    if (reserved.status === "address-taken") return reserved;
    if (reserved.status === "name-taken") return reserved;
    return {
      status: "reserved",
      libraryId: reserved.libraryId,
      name: reserved.name,
      publicAddress: reserved.publicAddress,
      shortName: reserved.shortName,
      slug: reserved.slug,
    };
  },
});

/**
 * Moves a live library to the next free address. The same check the new
 * library page uses decides the address: our database, then the hosts Coolify
 * serves, then the host itself. Nothing is written until the publish that
 * follows has changed Coolify's domain.
 */
export const moveLibraryAddress = action({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.union(
    v.object({
      status: v.literal("moving"),
      movedFrom: v.string(),
      movedTo: v.string(),
    }),
    unavailableValidator,
  ),
  handler: async (
    ctx,
    args,
  ): Promise<
    | { status: "moving"; movedFrom: string; movedTo: string }
    | { status: "unavailable"; reason: "check-failed" | "no-address" }
  > => {
    const plan = await ctx.runQuery(
      internal.evidenceLibraries.addressRecovery.readOwnerMoveCandidates,
      { libraryId: args.libraryId },
    );
    let candidate: { publicAddress: string; slug: string } | null;
    try {
      candidate = await findFreeEvidenceLibraryAddress(ctx, plan.candidates);
    } catch {
      return { status: "unavailable", reason: "check-failed" };
    }
    if (!candidate) return { status: "unavailable", reason: "no-address" };
    const moved = await ctx.runMutation(
      internal.evidenceLibraries.versions.startAddressMove,
      { libraryId: args.libraryId, candidate },
    );
    return {
      status: "moving",
      movedFrom: moved.movedFrom,
      movedTo: moved.movedTo,
    };
  },
});
