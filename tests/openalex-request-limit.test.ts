// OpenAlex search stops at the per-visitor limit, with a result the page shows as "too many requests" (#355).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OPENALEX_REQUEST_LIMITS } from "@/lib/openalex/request-limiter";
import { DEFAULT_FILTERS } from "@/lib/utils";

const { works, caller } = vi.hoisted(() => ({
  works: vi.fn(async () => ({ results: [], meta: { count: 0 } })),
  caller: { userId: null as string | null, address: "203.0.113.7" },
}));
vi.mock("@/lib/openalex", () => ({ default: { works } }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: caller.userId }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "cf-connecting-ip": caller.address }) }));

const filters = DEFAULT_FILTERS as never;

describe("OpenAlex search limits", () => {
  beforeEach(() => {
    vi.resetModules();
    works.mockClear();
  });

  it("refuses a signed-out visitor past their minute's searches without asking OpenAlex", async () => {
    const { getSearchResults } = await import("@/app/actions/openalex");
    const burst = OPENALEX_REQUEST_LIMITS.visitor.perMinute;
    for (let i = 0; i < burst; i++) expect(await getSearchResults("tutoring", filters)).toMatchObject({ ok: true });
    expect(await getSearchResults("tutoring", filters)).toMatchObject({ ok: false, status: 429 });
    expect(works).toHaveBeenCalledTimes(burst);

    // Another visitor, and a signed-in account, still search.
    caller.address = "198.51.100.4";
    expect(await getSearchResults("tutoring", filters)).toMatchObject({ ok: true });
    caller.userId = "user_signed_in";
    expect(await getSearchResults("tutoring", filters)).toMatchObject({ ok: true });
  });
});
