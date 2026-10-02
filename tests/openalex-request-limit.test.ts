// OpenAlex search stops at the per-visitor limit, with a result the page shows as "too many requests" (#355).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPENALEX_REQUEST_LIMITS } from "@/lib/openalex/request-limiter";
import { DEFAULT_FILTERS } from "@/lib/utils";

const { asked, caller } = vi.hoisted(() => ({
  asked: vi.fn(async (_url: URL | string) => new Response(JSON.stringify({ results: [], meta: { count: 0 } }))),
  caller: { userId: null as string | null, address: "203.0.113.7" },
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: caller.userId }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "cf-connecting-ip": caller.address }) }));

const filters = DEFAULT_FILTERS as never;

describe("OpenAlex search limits", () => {
  beforeEach(() => {
    vi.resetModules();
    asked.mockClear();
    vi.stubGlobal("fetch", asked);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("refuses a signed-out visitor past their minute's searches without asking OpenAlex", async () => {
    const { getSearchResults } = await import("@/app/actions/openalex");
    const burst = OPENALEX_REQUEST_LIMITS.visitor.perMinute;
    for (let i = 0; i < burst; i++) expect(await getSearchResults("tutoring", filters)).toMatchObject({ ok: true });
    expect(await getSearchResults("tutoring", filters)).toMatchObject({ ok: false, status: 429 });
    expect(asked).toHaveBeenCalledTimes(burst);

    // Another visitor, and a signed-in account, still search.
    caller.address = "198.51.100.4";
    expect(await getSearchResults("tutoring", filters)).toMatchObject({ ok: true });
    caller.userId = "user_signed_in";
    expect(await getSearchResults("tutoring", filters)).toMatchObject({ ok: true });
  });
});
