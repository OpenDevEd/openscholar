import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import { fetchQuery } from "convex/nextjs";
import { readAuthorPublications } from "@/app/actions/author-publications";

vi.mock("convex/nextjs", () => ({ fetchQuery: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (read: unknown) => read }));

const profileId = "profile" as Id<"authorProfiles">;
const references = ["unavailable", "available"].map((name, index) => ({
  id: `publication-${index}`, itemKey: `ITEM000${index}`,
  library: { id: `library-${index}`, name, url: `https://${name}.example.org` },
}));
const card = {
  key: "ITEM0001", title: "Learning through feedback", itemType: "Report",
  date: "2026", numPages: "12", PDFCoverPageImage: "https://available.example.org/cover.jpg",
  creators: [{ firstName: "Maya", lastName: "Chen" }],
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("author publication loading", () => {
  it("retains available cards and reports a partial library failure", async () => {
    vi.mocked(fetchQuery).mockResolvedValue(references);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async (url: URL) =>
      url.hostname === "unavailable.example.org"
        ? new Response(null, { status: 503 })
        : Response.json({ item: card }),
    ));
    const result = await readAuthorPublications(profileId);
    expect(result.unavailableCount).toBe(1);
    expect(result.papers).toEqual([expect.objectContaining({
      id: "publication-1", title: card.title, cover: card.PDFCoverPageImage,
      url: "https://available.example.org/lib/ITEM0001", authors: "Maya Chen",
    })]);
  });

  it("omits removed publications without reporting an outage", async () => {
    vi.mocked(fetchQuery).mockResolvedValue([references[0]]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    expect(await readAuthorPublications(profileId)).toEqual({ papers: [], unavailableCount: 0 });
  });
});
