/**
 * @vitest-environment jsdom
 *
 * plan-05 — proves the deletion of `beforeExecute` from `useBatchOperation`
 * was non-regressive for `useBatchTranslation`'s manual-run state machine.
 *
 * The bug being fixed: when the in-flight guard short-circuited the
 * effect, `beforeExecute` was never invoked and `manualRunRequestId` was
 * never consumed, leaving `hasPendingManualRun=true` indefinitely. The
 * refactor moves consumption into `handleResult` (work-happens path) and
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
import { useTranslationStore } from "@/lib/store";

beforeEach(() => {
  executeMock.mockReset();
  // Reset Zustand store between tests (no public reset; clear by overwrite).
  useTranslationStore.setState({ translations: {}, showTranslations: {} });
});

describe("useBatchTranslation — beforeExecute removal", () => {
  it("consumes manualRunRequestId in handleResult so a same-id rerender with new uncached papers does not re-fire", async () => {
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
      autoTranslateResults: false,
      manualRunRequestId: 1,
      targetLanguageOverride: "es",
    };

    const { rerender } = renderHook((p) => useBatchTranslation(p), {
      initialProps: props,
    });

    await waitFor(() => {
      expect(executeMock).toHaveBeenCalledTimes(1);
    });

    // After handleResult fires, mrr=1 is consumed. Re-render with a NEW
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
      autoTranslateResults: false,
      manualRunRequestId: 1,
      targetLanguageOverride: "es",
    };

    const { rerender } = renderHook((p) => useBatchTranslation(p), {
      initialProps: props,
    });

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
