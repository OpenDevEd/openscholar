/**
 * @vitest-environment jsdom
 *
 * Behavioral tests for the chat composer's sources guard wiring.
 *
 * Plan 04 § Composer integration locks three contracts on top of the
 * existing message-composer:
 * - a role=status live-hint above the textarea showing
 *   `{included} of {total}` source count
 * - when included == 0, a role=alert banner with an [Include all] CTA
 * - the Send button is disabled when included == 0 (in addition to the
 *   pre-existing 'text empty' disabled condition)
 *
 * These tests assert the wiring against a mocked
 * listChatSourcesWithInclusion that returns rows with varying
 * inclusion state.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { MessageComposer } from "@/components/extraction/chat/message-composer";
import type { Doc } from "@/convex/_generated/dataModel";

const sendMessageMock = vi.fn().mockResolvedValue(undefined);
const bulkSetMock = vi.fn().mockResolvedValue({ changedCount: 0 });

let queryRows: Array<{ included: boolean; chatPaperId: string }> = [
  { included: true, chatPaperId: "cp1" },
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

describe("MessageComposer sources guard", () => {
  it("renders the live-hint with the included/total counts when sources exist", () => {
    queryRows = [
      { included: true, chatPaperId: "cp1" },
      { included: true, chatPaperId: "cp2" },
      { included: false, chatPaperId: "cp3" },
    ];
    const { container } = render(
      <MessageComposer job={makeJob()} threadId="t1" />,
    );
    const status = container.querySelector("[role='status']");
    expect(status).not.toBeNull();
    expect(status?.getAttribute("data-sources-included")).toBe("2");
    expect(status?.getAttribute("data-sources-total")).toBe("3");
    expect(status?.getAttribute("data-sources-count-state")).toBe("normal");
  });

  it("when included==0 shows the empty banner and disables Send even with non-empty text", () => {
    queryRows = [
      { included: false, chatPaperId: "cp1" },
      { included: false, chatPaperId: "cp2" },
    ];
    const { container } = render(
      <MessageComposer job={makeJob()} threadId="t1" />,
    );

    const status = container.querySelector("[role='status']");
    expect(status?.getAttribute("data-sources-count-state")).toBe("zero");

    const banner = container.querySelector("[data-composer-empty-banner]");
    expect(banner).not.toBeNull();
    expect(banner?.getAttribute("role")).toBe("alert");

    const sendBtn = container.querySelector("[data-action='send']");
    expect(sendBtn?.hasAttribute("disabled")).toBe(true);

    // Type text — Send should remain disabled because included==0 wins.
    const textarea = container.querySelector("textarea");
    fireEvent.change(textarea!, { target: { value: "hello" } });
    const sendBtnAfter = container.querySelector("[data-action='send']");
    expect(sendBtnAfter?.hasAttribute("disabled")).toBe(true);
  });

  it("clicking the banner [Include all] fires bulkSetChatPapers with sourceIds=undefined + included=true", () => {
    queryRows = [{ included: false, chatPaperId: "cp1" }];
    bulkSetMock.mockClear();
    const { container } = render(
      <MessageComposer job={makeJob()} threadId="t1" />,
    );
    const cta = container.querySelector("[data-composer-include-all]");
    fireEvent.click(cta as Element);
    expect(bulkSetMock).toHaveBeenCalledWith({
      jobId: makeJob()._id,
      sourceIds: undefined,
      included: true,
    });
  });
});
