// These queries share one full-size job. None writes to it.
import { convexTest } from "convex-test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import { MAX_SIZE, seedAccount, seedExtractionJob } from "../lib/maxSize.test-support";

const filters = { searchQuery: "", confidenceRange: [0, 100], statusFilters: [], questionFilters: [] };

describe("at the largest sizes the product allows", () => {
  let fixture: Awaited<ReturnType<typeof seed>>;

  async function seed() {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    const { jobId } = await seedExtractionJob(t, userId);
    return { as, jobId };
  }

  beforeAll(async () => {
    vi.useFakeTimers();
    fixture = await seed();
  }, 300_000);
  afterAll(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("a 1,000-paper, 50-question extraction job opens its results page and details", async () => {
    const { as, jobId } = fixture;
    const page = await as.query(api.extraction.queries.listJobResults, { jobId, filters, sortBy: "default", paginationOpts: { cursor: null, numItems: 25 } });
    expect(page.page).toHaveLength(25);
    expect(page.isDone).toBe(false);
    const details = await as.query(api.extraction.queries.getJobDetails, { jobId });
    expect(details).toMatchObject({ status: "ok" });
  }, 300_000);

  it("a 1,000-paper, 50-question extraction job shows its progress and retry summaries", async () => {
    const { as, jobId } = fixture;
    const results = MAX_SIZE.papersPerJob * MAX_SIZE.questionsPerJob;
    expect(await as.query(api.extraction.queries.countJobFailures, { jobId })).toEqual({ asked: results, answered: results, retryable: 0, permanent: {}, paperErrors: {} });
    // Counting a filtered view reads every paper of the job once.
    expect(await as.query(api.extraction.queries.countJobResults, { jobId, filters: { ...filters, confidenceRange: [0, 50] } })).toMatchObject({ all: MAX_SIZE.papersPerJob });
  }, 300_000);
});
