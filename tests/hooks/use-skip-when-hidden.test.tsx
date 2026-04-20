/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useSkipWhenHidden } from "@/lib/chat/use-skip-when-hidden";

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
});

describe("useSkipWhenHidden", () => {
  it("returns the passed args when the document is visible", () => {
    const args = { jobId: "job_1" };
    const { result } = renderHook(() => useSkipWhenHidden(args));
    expect(result.current).toBe(args);
  });

  it("returns 'skip' once visibility becomes hidden", () => {
    const args = { jobId: "job_1" };
    const { result } = renderHook(() => useSkipWhenHidden(args));
    expect(result.current).toBe(args);

    act(() => {
      setVisibility("hidden");
    });

    expect(result.current).toBe("skip");
  });

  it("returns args again when visibility flips back to visible", () => {
    const args = { jobId: "job_1" };
    const { result } = renderHook(() => useSkipWhenHidden(args));

    act(() => {
      setVisibility("hidden");
    });
    expect(result.current).toBe("skip");

    act(() => {
      setVisibility("visible");
    });
    expect(result.current).toBe(args);
  });

  it("seeds initial state from document.visibilityState at mount time", () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    const args = { jobId: "job_1" };
    const { result } = renderHook(() => useSkipWhenHidden(args));
    expect(result.current).toBe("skip");
  });
});
