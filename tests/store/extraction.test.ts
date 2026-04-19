import { describe, it, expect, beforeEach } from "vitest";
import { useExtractionStore } from "@/lib/store/extraction";

function resetStore() {
  useExtractionStore.setState({
    draftJob: {
      name: "",
      questions: [],
      mode: "extraction",
      chatModelId: null,
      usePdfs: false,
    },
  });
}

describe("useExtractionStore — P9 dual-mode draft", () => {
  beforeEach(() => {
    resetStore();
  });

  it("default mode is extraction with chatModelId null and usePdfs false", () => {
    const { draftJob } = useExtractionStore.getState();
    expect(draftJob.mode).toBe("extraction");
    expect(draftJob.chatModelId).toBeNull();
    expect(draftJob.usePdfs).toBe(false);
  });

  it("setMode('chat') clears questions + usePdfs and keeps name", () => {
    useExtractionStore.setState((s) => ({
      draftJob: {
        ...s.draftJob,
        name: "My draft",
        questions: [
          { key: "q1", question: "Year?", type: "number", description: "" },
        ],
        usePdfs: true,
      },
    }));

    useExtractionStore.getState().setMode("chat");

    const { draftJob } = useExtractionStore.getState();
    expect(draftJob.mode).toBe("chat");
    expect(draftJob.questions).toEqual([]);
    expect(draftJob.usePdfs).toBe(false);
    expect(draftJob.name).toBe("My draft");
  });

  it("setMode('extraction') clears chatModelId and keeps name + questions", () => {
    useExtractionStore.setState((s) => ({
      draftJob: {
        ...s.draftJob,
        name: "Another",
        mode: "chat",
        chatModelId: "models:abc" as never,
      },
    }));

    useExtractionStore.getState().setMode("extraction");

    const { draftJob } = useExtractionStore.getState();
    expect(draftJob.mode).toBe("extraction");
    expect(draftJob.chatModelId).toBeNull();
    expect(draftJob.name).toBe("Another");
  });

  it("setChatModelId + setUsePdfs patch the right slot", () => {
    useExtractionStore.getState().setChatModelId("models:xyz" as never);
    expect(useExtractionStore.getState().draftJob.chatModelId).toBe("models:xyz");

    useExtractionStore.getState().setUsePdfs(true);
    expect(useExtractionStore.getState().draftJob.usePdfs).toBe(true);
  });

  it("clearDraftJob resets mode to extraction and empties fields", () => {
    useExtractionStore.setState((s) => ({
      draftJob: {
        ...s.draftJob,
        name: "x",
        mode: "chat",
        chatModelId: "models:x" as never,
        usePdfs: true,
        questions: [{ key: "k", question: "q", type: "string", description: "" }],
      },
    }));

    useExtractionStore.getState().clearDraftJob();

    const { draftJob } = useExtractionStore.getState();
    expect(draftJob.name).toBe("");
    expect(draftJob.mode).toBe("extraction");
    expect(draftJob.chatModelId).toBeNull();
    expect(draftJob.usePdfs).toBe(false);
    expect(draftJob.questions).toEqual([]);
  });
});
