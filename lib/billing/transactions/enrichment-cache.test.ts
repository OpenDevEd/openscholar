import { describe, expect, it } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import { createEnrichmentCache } from "./enrichment-cache";

const pA = "p_a" as Id<"extractionPapers">;
const pB = "p_b" as Id<"extractionPapers">;
const jX = "j_x" as Id<"extractionJobs">;
const jY = "j_y" as Id<"extractionJobs">;

describe("createEnrichmentCache", () => {
  it("returns undefined for unknown ids (never-asked state)", () => {
    const cache = createEnrichmentCache();
    expect(cache.getPaperTitle(pA)).toBeUndefined();
    expect(cache.getPaperTitleByOpenalex("W1")).toBeUndefined();
    expect(cache.getJobName(jX)).toBeUndefined();
  });

  it("returns stored title after recordPaperResolved", () => {
    const cache = createEnrichmentCache();
    cache.recordPaperResolved(pA, "The Ethics of AI");
    expect(cache.getPaperTitle(pA)).toBe("The Ethics of AI");
  });

  it("returns null after recordPaperNotFound (resolved-missing, distinct from never-asked)", () => {
    const cache = createEnrichmentCache();
    cache.recordPaperNotFound(pA);
    expect(cache.getPaperTitle(pA)).toBeNull();
    expect(cache.getPaperTitle(pB)).toBeUndefined();
  });

  it("selectUnresolved filters ids already in the cache (either state)", () => {
    const cache = createEnrichmentCache();
    cache.recordPaperResolved(pA, "A");
    cache.recordPaperByOpenalexNotFound("W1");
    cache.recordJobResolved(jX, "Job X");

    const out = cache.selectUnresolved({
      paperIds: [pA, pB],
      openalexIds: ["W1", "W2"],
      jobIds: [jX, jY],
    });
    expect(out.paperIds).toEqual([pB]);
    expect(out.openalexIds).toEqual(["W2"]);
    expect(out.jobIds).toEqual([jY]);
  });

  it("selectUnresolved deduplicates the input arrays", () => {
    const cache = createEnrichmentCache();
    const out = cache.selectUnresolved({
      paperIds: [pA, pA, pB],
      openalexIds: ["W1", "W1", "W2"],
      jobIds: [jX, jX, jY],
    });
    expect(out.paperIds).toEqual([pA, pB]);
    expect(out.openalexIds).toEqual(["W1", "W2"]);
    expect(out.jobIds).toEqual([jX, jY]);
  });

  it("paper-by-id and paper-by-openalex are tracked independently", () => {
    const cache = createEnrichmentCache();
    cache.recordPaperResolved(pA, "Known by id");
    cache.recordPaperByOpenalexResolved("W1", "Known by openalex");

    expect(cache.getPaperTitle(pA)).toBe("Known by id");
    expect(cache.getPaperTitleByOpenalex("W1")).toBe("Known by openalex");
    // the other state is untouched
    expect(cache.getPaperTitleByOpenalex("W2")).toBeUndefined();
    expect(cache.getPaperTitle(pB)).toBeUndefined();
  });

  it("job tracking is separate from paper tracking", () => {
    const cache = createEnrichmentCache();
    cache.recordJobResolved(jX, "Job X");
    cache.recordJobNotFound(jY);
    expect(cache.getJobName(jX)).toBe("Job X");
    expect(cache.getJobName(jY)).toBeNull();
    expect(cache.getPaperTitle("x" as Id<"extractionPapers">)).toBeUndefined();
  });
});
