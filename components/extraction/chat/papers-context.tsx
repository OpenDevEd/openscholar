"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { ChatSourceRow } from "@/convex/chat/chatPapers";
import type { Id } from "@/convex/_generated/dataModel";
import {
  resolvePaperFromRow,
  type ResolvablePaper,
} from "@/lib/chat/resolve-paper";
import { stabilizeRowsById } from "@/lib/chat/stabilize-rows";
import { useSkipWhenHidden } from "@/lib/chat/use-skip-when-hidden";

export interface PapersContextValue {
  jobId: Id<"extractionJobs">;
  /** Stabilized by id — reference is preserved across Convex transitions
   *  that return structurally-equal rows (see `stabilizeRowsById`). */
  rows: ReadonlyArray<ChatSourceRow>;
  /** O(1) lookup by `chatPaperId` for keyboard navigation / imperative paths. */
  rowsById: ReadonlyMap<Id<"chatPapers">, ChatSourceRow>;
  /** Citation-pill map: position → ResolvablePaper. */
  papersByPosition: ReadonlyMap<number, ResolvablePaper>;
  totalCount: number;
  includedCount: number;
  /** `true` only before the first Convex result arrives. */
  isLoading: boolean;
}

export const PapersContext = createContext<PapersContextValue | null>(null);

export function usePapersContext(): PapersContextValue {
  const ctx = useContext(PapersContext);
  if (!ctx) {
    throw new Error(
      "usePapersContext must be used within ChatPapersProvider",
    );
  }
  return ctx;
}

export function ChatPapersProvider({
  jobId,
  children,
}: {
  jobId: Id<"extractionJobs">;
  children: ReactNode;
}) {
  // Defensive marker: the derived memos below intentionally re-use the
  // prior `rows` array reference when content is structurally equal. The
  // React Compiler's auto-memoization can erase the `useRef`-driven
  // identity game if it treats the closure as stateless; keep this pragma
  // to opt out. Safe to remove if the Compiler is confirmed disabled.
  "use no memo";

  const skipArgs = useSkipWhenHidden({ jobId });
  const raw = useQuery(api.chat.chatPapers.listChatSourcesWithInclusion, skipArgs);
  const lastTotalCountRef = useRef(0);

  const prevRef = useRef<ChatSourceRow[] | undefined>(undefined);
  const rows = useMemo<ReadonlyArray<ChatSourceRow>>(() => {
    if (raw === undefined) return prevRef.current ?? [];
    const stable = stabilizeRowsById(prevRef.current, raw.rows);
    prevRef.current = stable;
    lastTotalCountRef.current = raw.totalCount;
    return stable;
  }, [raw]);

  useEffect(() => {
    return () => {
      prevRef.current = undefined;
    };
  }, []);

  const rowsById = useMemo(() => {
    const map = new Map<Id<"chatPapers">, ChatSourceRow>();
    for (const r of rows) map.set(r.chatPaperId, r);
    return map;
  }, [rows]);

  const papersByPosition = useMemo(() => {
    const map = new Map<number, ResolvablePaper>();
    for (const r of rows) map.set(r.position, resolvePaperFromRow(r));
    return map;
  }, [rows]);

  const totalCount =
    raw?.totalCount ?? lastTotalCountRef.current ?? rows.length;
  const includedCount = useMemo(
    () => rows.reduce((n, r) => n + (r.included ? 1 : 0), 0),
    [rows],
  );

  const value = useMemo<PapersContextValue>(
    () => ({
      jobId,
      rows,
      rowsById,
      papersByPosition,
      totalCount,
      includedCount,
      isLoading: raw === undefined,
    }),
    [jobId, rows, rowsById, papersByPosition, totalCount, includedCount, raw],
  );

  return (
    <PapersContext.Provider value={value}>{children}</PapersContext.Provider>
  );
}
