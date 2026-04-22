import { beforeEach, describe, expect, it, vi } from "vitest";

const authorizeThreadAccess = vi.fn();
const listMessages = vi.fn();
const listUIMessages = vi.fn();
const syncStreams = vi.fn();
const toUIMessages = vi.fn();

vi.mock("./auth", () => ({
  authorizeThreadAccess,
}));

vi.mock("./agent", () => ({
  paperChat: {},
}));

vi.mock("@convex-dev/agent", async () => {
  const actual =
    await vi.importActual<typeof import("@convex-dev/agent")>(
      "@convex-dev/agent",
    );
  return {
    ...actual,
    listMessages,
    listUIMessages,
    syncStreams,
    toUIMessages,
  };
});

describe("chat.messages.listThreadMessages read model", () => {
  beforeEach(() => {
    authorizeThreadAccess.mockReset();
    listMessages.mockReset();
    listUIMessages.mockReset();
    syncStreams.mockReset();
    toUIMessages.mockReset();
    authorizeThreadAccess.mockResolvedValue({
      job: { _id: "job_1" },
    });
  });

  it("reads one raw page, converts locally, enriches aborted/error fields, and keeps stream sync", async () => {
    const { listThreadMessages } = await import("./messages");

    listMessages.mockResolvedValue({
      page: [
        { _id: "m_success" },
        { _id: "m_abort", error: "AbortError: user_stopped" },
        { _id: "m_fail", error: '{"kind":"rate_limit","message":"busy"}' },
      ],
      isDone: false,
      continueCursor: "cursor:1",
    });
    toUIMessages.mockReturnValue([
      { id: "m_success", text: "All done.", status: "success" },
      { id: "m_abort", text: "Partial text before stop", status: "failed" },
      { id: "m_fail", text: "", status: "failed" },
    ]);
    syncStreams.mockResolvedValue({
      kind: "list",
      messages: [{ streamId: "stream_1", status: "streaming", order: 2 }],
    });

    const result = await (listThreadMessages as typeof listThreadMessages & {
      _handler: (
        ctx: unknown,
        args: {
          threadId: string;
          paginationOpts: { cursor: string | null; numItems: number };
          streamArgs?: { kind: "list"; startOrder?: number };
        },
      ) => Promise<unknown>;
    })._handler(
      {} as never,
      {
        threadId: "thread_1",
        paginationOpts: { cursor: null, numItems: 20 },
        streamArgs: { kind: "list", startOrder: 0 },
      },
    );

    expect(authorizeThreadAccess).toHaveBeenCalledWith(
      expect.anything(),
      "thread_1",
    );
    expect(listMessages).toHaveBeenCalledTimes(1);
    expect(listMessages).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        threadId: "thread_1",
        paginationOpts: {
          cursor: null,
          numItems: 20,
          maximumRowsRead: 160,
          maximumBytesRead: 262144,
        },
        streamArgs: { kind: "list", startOrder: 0 },
      },
    );
    expect(listUIMessages).not.toHaveBeenCalled();
    expect(toUIMessages).toHaveBeenCalledWith([
      { _id: "m_success" },
      { _id: "m_abort", error: "AbortError: user_stopped" },
      { _id: "m_fail", error: '{"kind":"rate_limit","message":"busy"}' },
    ]);
    expect(syncStreams).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        threadId: "thread_1",
        paginationOpts: { cursor: null, numItems: 20 },
        streamArgs: { kind: "list", startOrder: 0 },
        includeStatuses: ["streaming", "finished", "aborted"],
      },
    );
    expect(result).toEqual({
      page: [
        { id: "m_success", text: "All done.", status: "success" },
        {
          id: "m_abort",
          text: "Partial text before stop",
          status: "failed",
          aborted: true,
        },
        {
          id: "m_fail",
          text: "",
          status: "failed",
          error: '{"kind":"rate_limit","message":"busy"}',
        },
      ],
      isDone: false,
      continueCursor: "cursor:1",
      streams: {
        kind: "list",
        messages: [{ streamId: "stream_1", status: "streaming", order: 2 }],
      },
    });
  });
});
