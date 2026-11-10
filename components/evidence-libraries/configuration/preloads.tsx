"use client";

import { createContext, useContext } from "react";
import type { Preloaded } from "convex/react";
import { preloadedQueryResult } from "convex/nextjs";
import type { FunctionReference } from "convex/server";
import type { api } from "@/convex/_generated/api";

type EL = typeof api.evidenceLibraries;

/**
 * What the settings page's server read with it. Each card shows it until its own live read arrives, so every card is
 * its full height on the first frame, and a link to a card (`?section=team`) lands there once instead of being pushed
 * down as the cards above it fill in. A read the person may not make (a viewer's) is left out, and the card reads it as before.
 */
export type ConfigurationPreloads = {
  draft?: Preloaded<EL["queries"]["getDraft"]>;
  credentials?: Preloaded<EL["credentials"]["listCredentials"]>;
  publication?: Preloaded<EL["publicationProviders"]["get"]>;
  domains?: Preloaded<EL["domains"]["listDomains"]>;
  versions?: Preloaded<EL["versions"]["listVersionRows"]>;
  versionCount?: Preloaded<EL["versions"]["countVersions"]>;
  addressNotice?: Preloaded<EL["updates"]["getAddressNotice"]>;
  team?: Preloaded<EL["queries"]["listTeam"]>;
  sourceStatus?: Preloaded<EL["sourceStatus"]["listForLibrary"]>;
  lastCheck?: Preloaded<EL["updates"]["lastCheck"]>;
  /** Its applications to join waiting for an answer (OS-31), and how many, for its owners and editors. */
  applications?: Preloaded<EL["applications"]["waiting"]>;
  applicationsWaiting?: Preloaded<EL["applications"]["waitingCounts"]>;
};

const Preloads = createContext<ConfigurationPreloads>({});
export const ConfigurationPreloadsProvider = Preloads.Provider;

/** The live answer once it's there; until then the one the page's server read, when it read one. */
export function useWithPage<Query extends FunctionReference<"query">>(
  key: keyof ConfigurationPreloads,
  live: Query["_returnType"] | undefined,
): Query["_returnType"] | undefined {
  const preloaded = useContext(Preloads)[key] as Preloaded<Query> | undefined;
  return live !== undefined ? live : preloaded ? preloadedQueryResult(preloaded) : undefined;
}
