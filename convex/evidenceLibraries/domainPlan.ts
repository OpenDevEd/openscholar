/**
 * What the next activation does to the library's addresses.
 *
 * The owner chooses the main address and removes the current one the same
 * way they change any other setting: the choice is saved at once and applied
 * by the next activation. Adding, checking and removing any other domain
 * still applies on its own, because none of that changes what visitors see.
 */

import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type DomainActivationPlan = {
  /** The address the library calls its own once the next activation is live. */
  mainAddress: string;
  /** Set when that address differs from the live one. */
  canonical: {
    /** The domain the change is held on: the new main, or the old one. */
    domain: Doc<"evidenceLibraryDomains">;
    address: string;
    /**
     * The address being left is a custom domain, which may no longer be
     * reachable, so the change travels on a deployment.
     */
    redeploy: boolean;
  } | null;
  /** Main addresses the owner removed, taken off once the activation is live. */
  removals: Doc<"evidenceLibraryDomains">[];
  changed: boolean;
};

export async function readDomainActivationPlan(
  ctx: QueryCtx | MutationCtx,
  input: {
    library: Doc<"evidenceLibraries">;
    binding: Pick<
      Doc<"evidenceLibraryRuntimeBindings">,
      "targetBaseUrl" | "canonicalBaseUrl"
    >;
    draft: Pick<Doc<"evidenceLibraryConfigDrafts">, "mainDomainId"> | null;
  },
): Promise<DomainActivationPlan> {
  const rows = await ctx.db
    .query("evidenceLibraryDomains")
    .withIndex("by_libraryId", (index) =>
      index.eq("libraryId", input.library._id),
    )
    .collect();
  const platform = input.binding.targetBaseUrl;
  const live = input.binding.canonicalBaseUrl ?? platform;
  const choice = input.draft?.mainDomainId;
  const chosen =
    choice === undefined || choice === null
      ? null
      : (rows.find((row) => row._id === choice) ?? null);
  // A chosen domain that stopped working is not applied: the rest of the
  // activation goes ahead, and the section says the choice needs attention.
  const usable =
    chosen !== null &&
    chosen.state === "active" &&
    chosen.removingAt === undefined &&
    chosen.removeOnActivateAt === undefined;
  const leaving = rows.find((row) => row.role === "primary");
  // A main address the owner removed cannot stay the main address, so with
  // no usable choice the library goes back to its platform address.
  const mainAddress =
    choice === null
      ? platform
      : usable
        ? `https://${chosen.host}`
        : leaving?.removeOnActivateAt !== undefined
          ? platform
          : live;
  let canonical: DomainActivationPlan["canonical"] = null;
  if (mainAddress !== live) {
    const domain = mainAddress === platform ? leaving : chosen;
    if (domain) {
      canonical = {
        domain,
        address: mainAddress,
        redeploy: leaving !== undefined,
      };
    }
  }
  const removals = rows.filter((row) => row.removeOnActivateAt !== undefined);
  return {
    mainAddress,
    canonical,
    removals,
    changed: canonical !== null || removals.length > 0,
  };
}
