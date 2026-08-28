"use client";

/**
 * What the library itself says about the collections a site shows: their
 * database name, source and record count. Read once for the ids the owner
 * already shows, then shared by the Collections section and every
 * navigation and footer link editor, so no list has to guess from an id.
 */

import { useAction } from "convex/react";
import { createContext, type ReactNode, use, useContext, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type CollectionFact = { title: string; source: string; count: number };
export type CollectionFacts = ReadonlyMap<string, CollectionFact>;

type ResolvedCollection = { id: string } & CollectionFact;

type ResolveAction = (args: {
  libraryId: Id<"evidenceLibraries">;
  ids: string[];
}) => Promise<{ reason?: "not-set-up"; items: ResolvedCollection[] }>;

const EMPTY: CollectionFacts = new Map();
// Nothing to ask about: the same answer every render, so no render loop.
const NOTHING_TO_READ = Promise.resolve(new Map<string, CollectionFact>());

function readFacts(
  resolve: ResolveAction,
  libraryId: Id<"evidenceLibraries">,
  ids: readonly string[],
): Promise<Map<string, CollectionFact>> {
  if (ids.length === 0) return NOTHING_TO_READ;
  return resolve({ libraryId, ids: [...ids] })
    .then(
      (page) =>
        new Map(
          page.items.map((item) => [
            item.id,
            { title: item.title, source: item.source, count: item.count },
          ]),
        ),
    )
    // A library that cannot answer yet leaves the rows named by their id.
    .catch(() => new Map<string, CollectionFact>());
}

type ContextValue = {
  promise: Promise<Map<string, CollectionFact>>;
  /** Facts the picker read while the owner was choosing. */
  learned: Map<string, CollectionFact>;
  learn: (facts: ResolvedCollection[]) => void;
};

const CollectionFactsContext = createContext<ContextValue | null>(null);

/**
 * Reads the shown collections once. Put it around the sections; the ids of
 * the first render are the ones the library is asked about, and anything
 * the picker reads later is added without asking again.
 */
export function CollectionFactsProvider({
  libraryId,
  ids,
  children,
}: {
  libraryId: Id<"evidenceLibraries">;
  ids: readonly string[];
  children: ReactNode;
}) {
  const resolve = useAction(api.zotero.runtimeReadActions.resolveLibraryCollections) as ResolveAction;
  const [learned, setLearned] = useState<Map<string, CollectionFact>>(new Map());
  // Asked once, when the page opens, for the ids the site shows then. A
  // different library is a different page, so a new provider is mounted.
  const [promise] = useState(() => readFacts(resolve, libraryId, ids));
  return (
    <CollectionFactsContext
      value={{
        promise,
        learned,
        learn: (facts) =>
          setLearned((current) => {
            const next = new Map(current);
            for (const fact of facts) {
              next.set(fact.id, { title: fact.title, source: fact.source, count: fact.count });
            }
            return next;
          }),
      }}
    >
      {children}
    </CollectionFactsContext>
  );
}

/**
 * The facts of every collection this page knows about. Waits for the first
 * read, so put the caller inside a `Suspense` that says it is loading.
 */
export function useCollectionFacts(): CollectionFacts {
  const context = useContext(CollectionFactsContext);
  if (!context) return EMPTY;
  const read = use(context.promise);
  if (context.learned.size === 0) return read;
  return new Map([...read, ...context.learned]);
}

/** Remembers what a picker read, so link editors can name it too. */
export function useLearnCollections() {
  return useContext(CollectionFactsContext)?.learn ?? (() => {});
}
