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
import type { Doc } from "@/convex/_generated/dataModel";

expect.extend(toHaveNoViolations);

const sendMessageMock = vi.fn().mockResolvedValue(undefined);
const bulkSetMock = vi.fn().mockResolvedValue({ changedCount: 0 });

const queryRows = [
  { included: false, chatPaperId: "cp1" },
  { included: false, chatPaperId: "cp2" },
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
  useQuery: () => queryRows,
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
    const { container } = render(
      <MessageComposer job={makeJob()} threadId="t1" />,
    );
    expect(container.querySelector("[data-composer-empty-banner]")).not.toBeNull();
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});
