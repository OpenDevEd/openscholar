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
        {
          _id: "m_success",
          message: { role: "assistant" },
          order: 3,
          stepOrder: 0,
        },
        {
          _id: "m_abort",
          message: { role: "assistant" },
          order: 2,
          stepOrder: 0,
          error: "AbortError: user_stopped",
        },
        {
          _id: "m_fail",
          message: { role: "assistant" },
          order: 1,
          stepOrder: 0,
          error: '{"kind":"rate_limit","message":"busy"}',
        },
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
        paginationOpts: { cursor: null, numItems: 3 },
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
          numItems: 3,
          maximumRowsRead: 24,
          maximumBytesRead: 262144,
        },
        streamArgs: { kind: "list", startOrder: 0 },
      },
    );
    expect(listUIMessages).not.toHaveBeenCalled();
    expect(toUIMessages).toHaveBeenCalledWith([
      {
        _id: "m_success",
        message: { role: "assistant" },
        order: 3,
        stepOrder: 0,
      },
      {
        _id: "m_abort",
        message: { role: "assistant" },
        order: 2,
        stepOrder: 0,
        error: "AbortError: user_stopped",
      },
      {
        _id: "m_fail",
        message: { role: "assistant" },
        order: 1,
        stepOrder: 0,
        error: '{"kind":"rate_limit","message":"busy"}',
      },
    ]);
    expect(syncStreams).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        threadId: "thread_1",
        paginationOpts: { cursor: null, numItems: 3 },
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

  it("continues reading when cap pressure underfills the visible page with a split assistant turn", async () => {
    const { listThreadMessages } = await import("./messages");

    listMessages
      .mockResolvedValueOnce({
        page: [
          {
            _id: "m_assistant_step_2",
            message: { role: "assistant" },
            order: 30,
            stepOrder: 2,
          },
          {
            _id: "m_assistant_step_1",
            message: { role: "assistant" },
            order: 30,
            stepOrder: 1,
          },
        ],
        isDone: false,
        continueCursor: "cursor:underfilled",
      })
      .mockResolvedValueOnce({
        page: [
          {
            _id: "m_user_prev",
            message: { role: "user" },
            order: 29,
            stepOrder: 0,
          },
        ],
        isDone: true,
        continueCursor: "cursor:done",
      });
    toUIMessages.mockReturnValueOnce([
      {
        id: "m_assistant_step_2",
        role: "assistant",
        order: 30,
        stepOrder: 2,
        text: "done",
        status: "success",
      },
      {
        id: "m_assistant_step_1",
        role: "assistant",
        order: 30,
        stepOrder: 1,
        text: "",
        status: "success",
      },
      {
        id: "m_user_prev",
        role: "user",
        order: 29,
        stepOrder: 0,
        text: "previous question",
        status: "success",
      },
    ]);
    syncStreams.mockResolvedValue({
      kind: "list",
      messages: [],
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
        threadId: "thread_cap",
        paginationOpts: { cursor: null, numItems: 2 },
        streamArgs: { kind: "list", startOrder: 0 },
      },
    );

    expect(listMessages).toHaveBeenCalledTimes(2);
    expect(listMessages).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.anything(),
      {
        threadId: "thread_cap",
        paginationOpts: {
          cursor: null,
          numItems: 2,
          maximumRowsRead: 16,
          maximumBytesRead: 262144,
        },
        streamArgs: { kind: "list", startOrder: 0 },
      },
    );
    expect(listMessages).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.anything(),
      {
        threadId: "thread_cap",
        paginationOpts: {
          cursor: "cursor:underfilled",
          numItems: 2,
          maximumRowsRead: 16,
          maximumBytesRead: 262144,
        },
        streamArgs: { kind: "list", startOrder: 0 },
      },
    );
    expect(toUIMessages).toHaveBeenCalledTimes(1);
    expect(toUIMessages).toHaveBeenCalledWith([
      {
        _id: "m_assistant_step_2",
        message: { role: "assistant" },
        order: 30,
        stepOrder: 2,
      },
      {
        _id: "m_assistant_step_1",
        message: { role: "assistant" },
        order: 30,
        stepOrder: 1,
      },
      {
        _id: "m_user_prev",
        message: { role: "user" },
        order: 29,
        stepOrder: 0,
      },
    ]);
    expect(result).toEqual({
      page: [
        {
          id: "m_assistant_step_2",
          role: "assistant",
          order: 30,
          stepOrder: 2,
          text: "done",
          status: "success",
        },
        {
          id: "m_assistant_step_1",
          role: "assistant",
          order: 30,
          stepOrder: 1,
          text: "",
          status: "success",
        },
        {
          id: "m_user_prev",
          role: "user",
          order: 29,
          stepOrder: 0,
          text: "previous question",
          status: "success",
        },
      ],
      isDone: true,
      continueCursor: "cursor:done",
      streams: {
        kind: "list",
        messages: [],
      },
    });
  });
});
