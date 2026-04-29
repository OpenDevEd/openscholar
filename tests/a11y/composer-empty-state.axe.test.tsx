/**
 * @vitest-environment jsdom
 *
 * Plan 06 axe audit for the chat composer's zero-included empty state.
 *
 * When `chatPapers.includedCount === 0`, the composer surfaces:
 *   - role=status live-hint announcing the zero count
 *   - role=alert banner with `[Include all]` CTA
 *   - Send button disabled
 *
 * This audit confirms that the empty-state markup carries no axe
 * violations — the alert role, the disabled button's accessible name,
 * the live region pairing all pass.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { MessageComposer } from "@/components/extraction/chat/message-composer";
import { PapersContext } from "@/components/extraction/chat/papers-context";
import {
  fakePapersContext,
  mkChatSourceRow,
} from "@/tests/helpers/papers-context-fixture";
import type { Doc, Id } from "@/convex/_generated/dataModel";

expect.extend(toHaveNoViolations);

const sendMessageMock = vi.fn().mockResolvedValue(undefined);
const bulkSetMock = vi.fn().mockResolvedValue({ changedCount: 0 });

const JOB_ID = "job1" as unknown as Id<"extractionJobs">;
const zeroIncludedRows = [
  mkChatSourceRow({
    jobId: JOB_ID,
    chatPaperId: "cp1" as unknown as Id<"chatPapers">,
    sourceId: "src1" as unknown as Id<"extractionJobSources">,
    position: 1,
    included: false,
  }),
  mkChatSourceRow({
    jobId: JOB_ID,
    chatPaperId: "cp2" as unknown as Id<"chatPapers">,
    sourceId: "src2" as unknown as Id<"extractionJobSources">,
    position: 2,
    included: false,
  }),
];

vi.mock("next-intl", () => ({
  useTranslations: () =>
    (key: string, params?: Record<string, unknown>) =>
      params ? `${key}|${JSON.stringify(params)}` : key,
}));

vi.mock("convex/react", () => ({
  useMutation: (fnRef: unknown) => {
    if (fnRef === "sendMessage") {
      const fn = sendMessageMock;
      Object.assign(fn, { withOptimisticUpdate: () => fn });
      return fn;
    }
    if (fnRef === "bulkSetChatPapers") {
      const fn = bulkSetMock;
      Object.assign(fn, { withOptimisticUpdate: () => fn });
      return fn;
    }
    return vi.fn();
  },
}));

vi.mock("@convex-dev/agent/react", () => ({
  optimisticallySendMessage: () => () => {},
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    chat: {
      messages: {
        sendMessage: "sendMessage",
        abortGeneration: "abortGeneration",
        swapModel: "swapModel",
        listThreadMessages: "listThreadMessages",
      },
      model: { listChatModels: "listChatModels" },
      chatPapers: {
        listChatSourcesWithInclusion: "listChatSourcesWithInclusion",
        bulkSetChatPapers: "bulkSetChatPapers",
      },
    },
  },
}));

vi.mock("@/lib/toast", () => ({
  useAppToast: () => ({ error: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/extraction/chat/composer-model-picker", () => ({
  ComposerModelPicker: () => <div data-testid="composer-model-picker" />,
}));

// Stub the web-search toggle — its radix Tooltip needs TooltipProvider,
// and this audit only cares about the empty-state alert/banner markup.
vi.mock("@/components/extraction/chat/web-search-toggle", () => ({
  WebSearchToggle: () => <div data-testid="web-search-toggle" />,
}));

function makeJob(): Doc<"extractionJobs"> {
  return {
    _id: "job1" as unknown as Doc<"extractionJobs">["_id"],
    _creationTime: Date.now(),
    userId: "u1",
    name: "Test job",
    isGenerating: false,
  } as Doc<"extractionJobs">;
}

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

const AXE_OPTIONS = {
  rules: {
    "color-contrast": { enabled: false },
  },
} as const;

describe("composer empty-state a11y audit (plan-06)", () => {
  it("renders zero axe violations when zero sources are included", async () => {
    const ctx = fakePapersContext({ jobId: JOB_ID, rows: zeroIncludedRows });
    const { container } = render(
      <PapersContext.Provider value={ctx}>
        <MessageComposer job={makeJob()} threadId="t1" />
      </PapersContext.Provider>,
    );
    expect(container.querySelector("[data-composer-empty-banner]")).not.toBeNull();
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});
