import { describe, expect, it, vi } from "vitest";
import { createConvexAuthTokenFetcher } from "../lib/auth/convex-token-fetcher";

describe("convex auth token bridge", () => {
  it("uses getAccessToken when forceRefreshToken is false", async () => {
    const getAccessToken = vi.fn().mockResolvedValue("cached-token");
    const refresh = vi.fn().mockResolvedValue("refreshed-token");
    const fetchAccessToken = createConvexAuthTokenFetcher({
      getAccessToken,
      refresh,
    });

    const token = await fetchAccessToken({ forceRefreshToken: false });

    expect(token).toBe("cached-token");
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("uses refresh when forceRefreshToken is true", async () => {
    const getAccessToken = vi.fn().mockResolvedValue("cached-token");
    const refresh = vi.fn().mockResolvedValue("fresh-token");
    const fetchAccessToken = createConvexAuthTokenFetcher({
      getAccessToken,
      refresh,
    });

    const token = await fetchAccessToken({ forceRefreshToken: true });

    expect(token).toBe("fresh-token");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it("returns null on failures and allows future successful calls", async () => {
    const getAccessToken = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce("recovered-token");
    const refresh = vi.fn().mockResolvedValue("fresh-token");
    const fetchAccessToken = createConvexAuthTokenFetcher({
      getAccessToken,
      refresh,
    });

    const firstAttempt = await fetchAccessToken({ forceRefreshToken: false });
    const secondAttempt = await fetchAccessToken({ forceRefreshToken: false });

    expect(firstAttempt).toBeNull();
    expect(secondAttempt).toBe("recovered-token");
    expect(getAccessToken).toHaveBeenCalledTimes(2);
  });
});
