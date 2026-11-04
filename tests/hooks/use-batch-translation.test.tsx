/**
 * @vitest-environment jsdom
 *
 * plan-05 — proves the deletion of `beforeExecute` from `useBatchOperation`
 * was non-regressive for `useBatchTranslation`'s manual-run state machine.
 *
 * The bug being fixed: when the in-flight guard short-circuited the
 * effect, `beforeExecute` was never invoked and `manualRunRequestId` was
 * never consumed, leaving `hasPendingManualRun=true` indefinitely. The
 * refactor moves consumption to when a batch settles (work-happens path) and
 * a focused effect (all-cached path).
 *
 * Both tests assert observable behavior — whether `execute` re-fires for
 * a same-`manualRunRequestId` rerender that surfaces new uncached papers.
 * If consumption never happened, a follow-up rerender with new papers
 * would re-trigger work; if consumption happened, it stays quiet until
 * the user bumps `manualRunRequestId` again.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const { executeMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
}));

vi.mock("@/lib/ai/client/router", () => ({
  useBatchTranslations: () => ({
    execute: executeMock,
    isConfigured: true,
  }),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "es",
}));

import { useBatchTranslation } from "@/hooks/use-batch-translation";
import { useResultsTranslationSettingsStore, useTranslationStore } from "@/lib/store";

beforeEach(() => {
  executeMock.mockReset();
  // Reset Zustand store between tests (no public reset; clear by overwrite).
  useTranslationStore.setState({ translations: {}, showTranslations: {} });
  useResultsTranslationSettingsStore.setState({ targetLanguageOverride: null, autoTranslateResults: false, translationsUndone: false });
});

/** Long enough for a refused batch to settle and for any re-send to show. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));

type HookProps = Parameters<typeof useBatchTranslation>[0];

/** The hook mounted, then a person pressing Run. */
function pressRun(props: HookProps) {
  const hook = renderHook((p: HookProps) => useBatchTranslation(p), {
    initialProps: { ...props, manualRunRequestId: props.manualRunRequestId - 1 },
  });
  hook.rerender(props);
  return hook;
}

describe("useBatchTranslation — a refused batch", () => {
  const paper = { id: "p1", title: "Title 1", abstract: "Abstract 1" };

  it("is sent once with auto-translate on, however often the caller renders", async () => {
    executeMock.mockRejectedValue(new Error("refused"));
    useResultsTranslationSettingsStore.setState({ autoTranslateResults: true });
    const onBatchRejected = vi.fn();
    const props = {
      searchId: "s1",
      papers: [paper],
      canStart: true,
      manualRunRequestId: 0,
    };

    // A new callback each render, as a caller writing it inline passes.
    const { rerender } = renderHook(
      (p) => useBatchTranslation({ ...p, onBatchRejected: (error) => onBatchRejected(error) }),
      { initialProps: props },
    );
    await settle();
    rerender({ ...props });
    await settle();

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(onBatchRejected).toHaveBeenCalledTimes(1);
  });

  it("is sent again by the next run, and a refused run leaves the next paper alone", async () => {
    executeMock.mockRejectedValue(new Error("refused"));
    const props = {
      searchId: "s1",
      papers: [paper],
      canStart: true,
      manualRunRequestId: 1,
    };

    const { rerender } = pressRun(props);
    await settle();
    expect(executeMock).toHaveBeenCalledTimes(1);

    rerender({ ...props, papers: [{ id: "p2", title: "Title 2", abstract: "Abstract 2" }] });
    await settle();
    expect(executeMock).toHaveBeenCalledTimes(1);

    rerender({ ...props, manualRunRequestId: 2 });
    await settle();
    expect(executeMock).toHaveBeenCalledTimes(2);
  });
});

describe("useBatchTranslation — one batch at a time", () => {
  const paper = { id: "p1", title: "Title 1", abstract: "Abstract 1" };
  const translated = (id: string) => ({
    results: { [id]: { translatedTitle: "T", translatedAbstract: "A", noTranslationNeeded: false } },
    errors: [],
  });
  const manualRun = {
    searchId: "s1",
    canStart: true,
    manualRunRequestId: 1,
  };

  // The server refuses a person's second batch while the first runs. Focus mode's
  // control unmounts when it closes, and its batch runs on.
  it("holds a batch from another mount of the hook until the running one settles", async () => {
    let finishFirst = (_: unknown) => {};
    executeMock
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockResolvedValue(translated("p2"));

    const first = pressRun({ ...manualRun, papers: [paper] });
    await settle();
    expect(executeMock).toHaveBeenCalledTimes(1);
    first.unmount();

    pressRun({ ...manualRun, papers: [{ id: "p2", title: "Title 2", abstract: "Abstract 2" }] });
    await settle();
    expect(executeMock).toHaveBeenCalledTimes(1);

    finishFirst(translated("p1"));
    await settle();
    expect(executeMock).toHaveBeenCalledTimes(2);
  });

  it("carries a run over to a language picked while it runs", async () => {
    let finishFirst = (_: unknown) => {};
    executeMock
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockResolvedValue(translated("p1"));

    pressRun({ ...manualRun, papers: [paper] });
    await settle();
    act(() => useResultsTranslationSettingsStore.setState({ targetLanguageOverride: "fr" }));
    await settle();
    expect(executeMock).toHaveBeenCalledTimes(1);

    finishFirst(translated("p1"));
    await settle();
    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(executeMock.mock.lastCall?.[0]).toMatchObject({ targetLanguage: "fr" });
    expect(useTranslationStore.getState().getTranslation("p1", "fr")).not.toBeNull();
    // The first batch was paid for, so coming back to its language costs nothing.
    expect(useTranslationStore.getState().getTranslation("p1", "es")).not.toBeNull();

    // That run is then over: the paper stays as it is until the next one.
    act(() => useResultsTranslationSettingsStore.setState({ targetLanguageOverride: "de" }));
    await settle();
    expect(executeMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the running batch's result when the language comes back to it", async () => {
    let finishFirst = (_: unknown) => {};
    executeMock.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));

    pressRun({ ...manualRun, papers: [paper] });
    await settle();
    act(() => useResultsTranslationSettingsStore.setState({ targetLanguageOverride: "fr" }));
    await settle();
    act(() => useResultsTranslationSettingsStore.setState({ targetLanguageOverride: null }));
    await settle();

    finishFirst(translated("p1"));
    await settle();
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(useTranslationStore.getState().getTranslation("p1", "es")).not.toBeNull();
  });

  // Each of these is a paper paid for twice.
  it("leaves out of a waiting batch a paper the batch ahead of it translated", async () => {
    let finishFirst = (_: unknown) => {};
    executeMock
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockResolvedValue(translated("p2"));

    pressRun({ ...manualRun, papers: [paper] });
    await settle();
    pressRun({ ...manualRun, papers: [paper, { id: "p2", title: "Title 2", abstract: "Abstract 2" }] });
    await settle();

    finishFirst(translated("p1"));
    await settle();
    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(executeMock.mock.lastCall?.[0].papers.map((p: { id: string }) => p.id)).toEqual(["p2"]);
  });

  it("sends nothing when the batch ahead translated every paper", async () => {
    let finishFirst = (_: unknown) => {};
    executeMock.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));

    pressRun({ ...manualRun, papers: [paper] });
    await settle();
    pressRun({ ...manualRun, papers: [paper] });
    await settle();

    finishFirst(translated("p1"));
    await settle();
    expect(executeMock).toHaveBeenCalledTimes(1);
  });
});

describe("useBatchTranslation — auto-translate", () => {
  const translated = (id: string) => ({
    results: { [id]: { translatedTitle: "T", translatedAbstract: "A", noTranslationNeeded: false } },
    errors: [],
  });
  const auto = (id: string) => ({
    searchId: id,
    papers: [{ id, title: "Title", abstract: "Abstract" }],
    canStart: true,
    manualRunRequestId: 0,
  });

  it("sends no batch still waiting its turn once it is switched off", async () => {
    let finishFirst = (_: unknown) => {};
    executeMock.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
    useResultsTranslationSettingsStore.setState({ autoTranslateResults: true });

    renderHook((p: HookProps) => useBatchTranslation(p), { initialProps: auto("p1") });
    await settle();
    renderHook((p: HookProps) => useBatchTranslation(p), { initialProps: auto("p2") });
    await settle();

    useResultsTranslationSettingsStore.setState({ autoTranslateResults: false });
    finishFirst(translated("p1"));
    await settle();
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("translates a cancelled batch's papers when it is switched back on", async () => {
    let finishFirst = (_: unknown) => {};
    executeMock
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockResolvedValue(translated("p2"));
    useResultsTranslationSettingsStore.setState({ autoTranslateResults: true });

    renderHook((p: HookProps) => useBatchTranslation(p), { initialProps: auto("p1") });
    await settle();
    renderHook((p: HookProps) => useBatchTranslation(p), { initialProps: auto("p2") });
    await settle();

    act(() => useResultsTranslationSettingsStore.setState({ autoTranslateResults: false }));
    finishFirst(translated("p1"));
    await settle();
    expect(executeMock).toHaveBeenCalledTimes(1);

    act(() => useResultsTranslationSettingsStore.setState({ autoTranslateResults: true }));
    await settle();
    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(executeMock.mock.lastCall?.[0].papers.map((p: { id: string }) => p.id)).toEqual(["p2"]);
  });

  it("still sends a waiting Run once it is switched off", async () => {
    let finishFirst = (_: unknown) => {};
    executeMock
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockResolvedValue(translated("p2"));
    useResultsTranslationSettingsStore.setState({ autoTranslateResults: true });

    renderHook((p: HookProps) => useBatchTranslation(p), { initialProps: auto("p1") });
    await settle();
    pressRun({ ...auto("p2"), manualRunRequestId: 1 });
    await settle();

    useResultsTranslationSettingsStore.setState({ autoTranslateResults: false });
    finishFirst(translated("p1"));
    await settle();
    expect(executeMock).toHaveBeenCalledTimes(2);
  });
});

describe("useBatchTranslation — Undo translation", () => {
  const paper = { id: "p1", title: "Title 1", abstract: "Abstract 1" };
  const translated = { results: { p1: { translatedTitle: "T", translatedAbstract: "A", noTranslationNeeded: false } }, errors: [] };
  const props = { searchId: "s1", papers: [paper], canStart: true, manualRunRequestId: 1 };
  const setUndone = (undone: boolean) => act(() => useResultsTranslationSettingsStore.getState().setTranslationsUndone(undone));

  it("stops counting a paper as translated, and running again brings it back without paying twice", async () => {
    executeMock.mockResolvedValue(translated);
    const { result, rerender } = pressRun(props);
    await settle();
    expect(result.current.translatedPaperCount).toBe(1);

    setUndone(true);
    expect(result.current.translatedPaperCount).toBe(0);

    // As the menu's Run does.
    setUndone(false);
    rerender({ ...props, manualRunRequestId: 2 });
    await settle();
    expect(result.current.translatedPaperCount).toBe(1);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("stays undone when a batch still running comes back afterwards, and keeps what it paid for", async () => {
    let finish = (_: unknown) => {};
    executeMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = pressRun(props);
    await settle();

    setUndone(true);
    finish(translated);
    await settle();
    expect(result.current.translatedPaperCount).toBe(0);

    setUndone(false);
    expect(result.current.translatedPaperCount).toBe(1);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });
});

describe("useBatchTranslation — Run clicks", () => {
  // The results page mounts again on a new search, and the run count outlives it.
  it("takes no run from before it mounted for its own", async () => {
    renderHook((p: HookProps) => useBatchTranslation(p), {
      initialProps: {
        searchId: "s2",
        papers: [{ id: "p1", title: "Title 1", abstract: "Abstract 1" }],
        canStart: true,
        manualRunRequestId: 3,
      },
    });
    await settle();
    expect(executeMock).not.toHaveBeenCalled();
  });
});

describe("useBatchTranslation — beforeExecute removal", () => {
  it("consumes manualRunRequestId when the batch settles so a same-id rerender with new uncached papers does not re-fire", async () => {
    executeMock.mockResolvedValue({
      results: {
        p1: {
          translatedTitle: "T1",
          translatedAbstract: "A1",
          noTranslationNeeded: false,
        },
      },
      errors: [],
    });

    const props = {
      searchId: "s1",
      papers: [{ id: "p1", title: "Title 1", abstract: "Abstract 1" }],
      canStart: true,
      manualRunRequestId: 1,
    };

    const { rerender } = pressRun(props);

    await waitFor(() => {
      expect(executeMock).toHaveBeenCalledTimes(1);
    });

    // Once the batch settles, mrr=1 is consumed. Re-render with a NEW
    // paper p2 that has no translation cached. Without consumption, the
    // hook would think it still has a pending manual-run and re-fire
    // execute for [p2]. With consumption, effectiveCanStart=false and
    // execute stays at 1 call.
    rerender({
      ...props,
      papers: [
        { id: "p1", title: "Title 1", abstract: "Abstract 1" },
        { id: "p2", title: "Title 2", abstract: "Abstract 2" },
      ],
    });

    // Wait a tick so the effect has a chance to mis-fire (it must not).
    await act(async () => {
      await Promise.resolve();
    });
    expect(executeMock).toHaveBeenCalledTimes(1);

    // Bumping mrr unblocks the next manual run.
    executeMock.mockResolvedValueOnce({
      results: {
        p2: {
          translatedTitle: "T2",
          translatedAbstract: "A2",
          noTranslationNeeded: false,
        },
      },
      errors: [],
    });
    rerender({
      ...props,
      papers: [
        { id: "p1", title: "Title 1", abstract: "Abstract 1" },
        { id: "p2", title: "Title 2", abstract: "Abstract 2" },
      ],
      manualRunRequestId: 2,
    });

    await waitFor(() => {
      expect(executeMock).toHaveBeenCalledTimes(2);
    });
  });

  it("consumes manualRunRequestId via the all-cached effect when every paper is already translated", async () => {
    // Pre-seed the translation store so p1@es is cached.
    useTranslationStore.setState({
      translations: {
        "p1:es": {
          translatedTitle: "T1",
          translatedAbstract: "A1",
          noTranslationNeeded: false,
          targetLanguage: "es",
        },
      },
      showTranslations: {},
    });

    const props = {
      searchId: "s1",
      papers: [{ id: "p1", title: "Title 1", abstract: "Abstract 1" }],
      canStart: true,
      manualRunRequestId: 1,
    };

    const { rerender } = pressRun(props);

    // Nothing to fetch — execute stays untouched.
    await act(async () => {
      await Promise.resolve();
    });
    expect(executeMock).not.toHaveBeenCalled();

    // The all-cached effect has consumed mrr. Re-render with a NEW
    // uncached paper p2. effectiveCanStart should be false because the
    // manual-run flag was consumed; execute must stay quiet.
    rerender({
      ...props,
      papers: [
        { id: "p1", title: "Title 1", abstract: "Abstract 1" },
        { id: "p2", title: "Title 2", abstract: "Abstract 2" },
      ],
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(executeMock).not.toHaveBeenCalled();

    // Bumping mrr to 2 starts a new manual run.
    executeMock.mockResolvedValueOnce({
      results: {
        p2: {
          translatedTitle: "T2",
          translatedAbstract: "A2",
          noTranslationNeeded: false,
        },
      },
      errors: [],
    });
    rerender({
      ...props,
      papers: [
        { id: "p1", title: "Title 1", abstract: "Abstract 1" },
        { id: "p2", title: "Title 2", abstract: "Abstract 2" },
      ],
      manualRunRequestId: 2,
    });

    await waitFor(() => {
      expect(executeMock).toHaveBeenCalledTimes(1);
    });
  });
});
