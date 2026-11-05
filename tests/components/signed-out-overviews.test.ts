import { afterEach, beforeEach, expect, it, vi } from "vitest";

const capture = vi.fn();
vi.mock("posthog-js", () => ({ default: { capture: (...args: unknown[]) => capture(...args) } }));

const { ensureSignedOut, useSignedOutOverviews } = await import("@/components/ai-overview/signed-out");
const { TurnstileCancelled } = await import("@/components/ai-overview/turnstile");

const REQUEST = { params: "q=peer+tutoring", lens: "overview", locale: "en-US" };
const token = async () => "token";
/** /api/overviews answering these pieces of its body, split wherever the test splits them. */
const answering = (...chunks: string[]) =>
  vi.fn(async () => new Response(new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
    controller.close();
  } })));

beforeEach(() => useSignedOutOverviews.setState({ runs: {}, outOn: null, off: false }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  capture.mockClear();
});

it("builds the overview from lines that arrive split across pieces", async () => {
  vi.stubGlobal("fetch", answering('{"step":"count:year::"}\n{"count":{"id":"c1",', '"by":"year","total":5,"groups":[]}}\n{"list":{"id":"p1","papers":[{"id":"W1","title":"T","cited":2}]}}\n', '{"text":"Five papers.","done":true}\n'));
  await ensureSignedOut("k", REQUEST, token, "auto");
  expect(useSignedOutOverviews.getState().runs.k).toMatchObject({ status: "done", text: "Five papers.", counts: [{ id: "c1", total: 5 }], lists: [{ id: "p1" }] });
  expect(capture).toHaveBeenCalledWith("overview_written", expect.objectContaining({ signed_in: false, counts: 1, papers: 1, chars: 12 }));
});

it("stops writing new ones once the visitor's day is used, keeping those already written, until the next UTC day", async () => {
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 5, 23, 50), toFake: ["Date"] });
  vi.stubGlobal("fetch", answering('{"text":"Written.","done":true}\n'));
  await ensureSignedOut("written", REQUEST, token, "auto");
  vi.stubGlobal("fetch", answering('{"limit":true}\n'));
  await ensureSignedOut("next", { ...REQUEST, lens: "trend" }, token, "auto");
  const state = useSignedOutOverviews.getState();
  expect(state.outOn).toBe("2026-11-05");
  expect(Object.keys(state.runs)).toEqual(["written"]);
  const later = answering('{"text":"x","done":true}\n');
  vi.stubGlobal("fetch", later);
  await ensureSignedOut("third", { ...REQUEST, lens: "where" }, token, "auto");
  expect(later).not.toHaveBeenCalled();
  vi.setSystemTime(Date.UTC(2026, 10, 6, 0, 5));
  await ensureSignedOut("third", { ...REQUEST, lens: "where" }, token, "auto");
  expect(later).toHaveBeenCalledOnce();
});

it("lets an overview whose card went before Turnstile answered start again, without calling it failed", async () => {
  const never = vi.fn();
  vi.stubGlobal("fetch", never);
  await ensureSignedOut("left", REQUEST, async () => Promise.reject(new TurnstileCancelled("gone")), "auto");
  expect(never).not.toHaveBeenCalled();
  expect(useSignedOutOverviews.getState().runs.left).toBeUndefined();
  expect(capture).not.toHaveBeenCalledWith("overview_failed", expect.anything());
});

it("counts a run that broke off as failed, and one Turnstile couldn't vouch for as unverified, asking nothing", async () => {
  vi.stubGlobal("fetch", answering('{"step":"writing"}\n'));
  await ensureSignedOut("broke", REQUEST, token, "auto");
  expect(useSignedOutOverviews.getState().runs.broke).toMatchObject({ status: "failed", because: "failed" });
  const never = vi.fn();
  vi.stubGlobal("fetch", never);
  await ensureSignedOut("unverified", REQUEST, async () => Promise.reject(new Error("no")), "auto");
  expect(never).not.toHaveBeenCalled();
  expect(useSignedOutOverviews.getState().runs.unverified).toMatchObject({ status: "failed", because: "verify" });
});
