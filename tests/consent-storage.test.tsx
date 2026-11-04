// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { storeConsent, useAnalyticsConsent, useConsentAnsweredAt } from "@/lib/consent-storage";

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("cookie banner answer", () => {
  it("reports a repeated answer, so another device's newer answer on the account can be replaced", () => {
    vi.useFakeTimers({ now: 1_000 });
    const { result } = renderHook(() => ({ consented: useAnalyticsConsent(), answeredAt: useConsentAnsweredAt() }));
    expect(result.current.answeredAt).toBeNull();

    act(() => storeConsent("denied"));
    const first = result.current.answeredAt;
    vi.setSystemTime(2_000);
    act(() => storeConsent("denied"));

    expect(result.current.consented).toBe(false);
    expect(first).not.toBeNull();
    expect(result.current.answeredAt).not.toBe(first);
  });
});
