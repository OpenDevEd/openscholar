/**
 * @vitest-environment jsdom
 *
 * Plan 01 / D2 behavioral assertion: the provider preserves row identity
 * across Convex transitions that return structurally-equal rows. This is
 * the integration contract that makes React.memo(SourceRow, prev.row ===
 * next.row) effective — when a user types in the search field, the
 * provider's `rows` reference stays identical for unchanged rows, so the
 * memo'd row skips re-rendering.
 *
 * Composes with `tests/lib/chat/stabilize-rows.test.ts` (15 unit cases)
 * to cover the end-to-end ref-stability chain.
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import {
  ChatPapersProvider,
  usePapersContext,
} from "@/components/extraction/chat/papers-context";
import type { ChatSourceRow } from "@/convex/chat/chatPapers";
import type { Id } from "@/convex/_generated/dataModel";
import { mkChatSourceRow } from "@/tests/helpers/papers-context-fixture";

let currentRows: ChatSourceRow[] | undefined = undefined;
let currentTotalCount: number | undefined = undefined;

vi.mock("convex/react", () => ({
  useQuery: () => ({
    rows: currentRows ?? [],
    totalCount: currentTotalCount ?? currentRows?.length ?? 0,
  }),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    chat: {
      chatPapers: {
        listChatSourcesWithInclusion: "stub:listChatSourcesWithInclusion",
      },
    },
  },
}));

const JOB_ID = "job_test" as Id<"extractionJobs">;

// Records every `rows` reference the consumer observed, so the test can
// compare array identity across re-renders.
const observedRows: ReadonlyArray<ChatSourceRow>[] = [];

function RowsProbe() {
  const { rows, totalCount, includedCount } = usePapersContext();
  observedRows.push(rows);
  return (
    <div
      data-testid="rows-probe"
      data-total={totalCount}
      data-included={includedCount}
      data-rows-length={rows.length}
    />
  );
}

describe("<ChatPapersProvider> identity contract", () => {
  it("preserves the rows reference across structurally-equal Convex transitions", () => {
    observedRows.length = 0;
    const rowsA = [
      mkChatSourceRow({
        chatPaperId: "cp1" as Id<"chatPapers">,
        position: 1,
      }),
      mkChatSourceRow({
        chatPaperId: "cp2" as Id<"chatPapers">,
        position: 2,
      }),
    ];
    currentRows = rowsA;
    currentTotalCount = rowsA.length;

    const { rerender } = render(
      <ChatPapersProvider jobId={JOB_ID}>
        <RowsProbe />
      </ChatPapersProvider>,
    );

    const firstRowsSnapshot = observedRows[observedRows.length - 1]!;
    expect(firstRowsSnapshot).toHaveLength(2);

    currentRows = rowsA.map((r) => ({ ...r }));
    currentTotalCount = rowsA.length;
    rerender(
      <ChatPapersProvider jobId={JOB_ID}>
        <RowsProbe />
      </ChatPapersProvider>,
    );

    const secondRowsSnapshot = observedRows[observedRows.length - 1]!;
    // The ARRAY itself is a fresh copy per render (stabilizeRowsById
    // always returns a new array). What matters for React.memo is that
    // individual element references are preserved when content is equal.
    expect(secondRowsSnapshot).toHaveLength(firstRowsSnapshot.length);
    expect(secondRowsSnapshot[0]).toBe(firstRowsSnapshot[0]);
    expect(secondRowsSnapshot[1]).toBe(firstRowsSnapshot[1]);
  });

  it("swaps exactly one row ref when one paper's `included` flips", () => {
    observedRows.length = 0;
    const rowsA = [
      mkChatSourceRow({
        chatPaperId: "cp1" as Id<"chatPapers">,
        position: 1,
        included: true,
      }),
      mkChatSourceRow({
        chatPaperId: "cp2" as Id<"chatPapers">,
        position: 2,
        included: true,
      }),
      mkChatSourceRow({
        chatPaperId: "cp3" as Id<"chatPapers">,
        position: 3,
        included: true,
      }),
    ];
    currentRows = rowsA;
    currentTotalCount = rowsA.length;

    const { rerender } = render(
      <ChatPapersProvider jobId={JOB_ID}>
        <RowsProbe />
      </ChatPapersProvider>,
    );

    const snapshotA = observedRows[observedRows.length - 1]!;

    currentRows = rowsA.map((r, i) =>
      i === 1 ? { ...r, included: !r.included } : { ...r },
    );
    currentTotalCount = rowsA.length;
    rerender(
      <ChatPapersProvider jobId={JOB_ID}>
        <RowsProbe />
      </ChatPapersProvider>,
    );

    const snapshotB = observedRows[observedRows.length - 1]!;
    expect(snapshotB[0]).toBe(snapshotA[0]);
    expect(snapshotB[1]).not.toBe(snapshotA[1]);
    expect(snapshotB[2]).toBe(snapshotA[2]);
    expect(snapshotB[1]?.included).toBe(false);
  });

  it("exposes totalCount and includedCount derived from rows", () => {
    observedRows.length = 0;
    currentRows = [
      mkChatSourceRow({
        chatPaperId: "cp1" as Id<"chatPapers">,
        position: 1,
        included: true,
      }),
      mkChatSourceRow({
        chatPaperId: "cp2" as Id<"chatPapers">,
        position: 2,
        included: false,
      }),
      mkChatSourceRow({
        chatPaperId: "cp3" as Id<"chatPapers">,
        position: 3,
        included: true,
      }),
    ];
    currentTotalCount = currentRows.length;

    const { container } = render(
      <ChatPapersProvider jobId={JOB_ID}>
        <RowsProbe />
      </ChatPapersProvider>,
    );

    const probe = container.querySelector("[data-testid='rows-probe']");
    expect(probe?.getAttribute("data-total")).toBe("3");
    expect(probe?.getAttribute("data-included")).toBe("2");
  });

  it("keeps totalCount authoritative even while bootstrap rows are still incomplete", () => {
    observedRows.length = 0;
    currentRows = [
      mkChatSourceRow({
        chatPaperId: "cp1" as Id<"chatPapers">,
        position: 1,
      }),
    ];
    currentTotalCount = 2;

    const { container } = render(
      <ChatPapersProvider jobId={JOB_ID}>
        <RowsProbe />
      </ChatPapersProvider>,
    );

    const probe = container.querySelector("[data-testid='rows-probe']");
    expect(probe?.getAttribute("data-total")).toBe("2");
    expect(probe?.getAttribute("data-rows-length")).toBe("1");
  });
});
