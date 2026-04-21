import type { Id } from "@/convex/_generated/dataModel";

/**
 * Per-export enrichment cache — memoizes paper-title and job-name lookups
 * across pages so a 10k-row export doesn't re-fetch the same paper titles
 * once per page.
 *
 * Tri-state encoding per key:
 *   - `undefined` → never asked about
 *   - `null`      → resolved, but not found (paper/job deleted)
 *   - `string`    → resolved value
 *
 * The `null` state prevents re-querying something we already failed to
 * find.
 */
export interface EnrichmentCache {
  getPaperTitle(
    paperId: Id<"extractionPapers">,
  ): string | null | undefined;
  getPaperTitleByOpenalex(
    openalexId: string,
  ): string | null | undefined;
  getJobName(jobId: Id<"extractionJobs">): string | null | undefined;

  recordPaperResolved(
    id: Id<"extractionPapers">,
    title: string,
  ): void;
  recordPaperNotFound(id: Id<"extractionPapers">): void;
  recordPaperByOpenalexResolved(openalexId: string, title: string): void;
  recordPaperByOpenalexNotFound(openalexId: string): void;
  recordJobResolved(id: Id<"extractionJobs">, name: string): void;
  recordJobNotFound(id: Id<"extractionJobs">): void;

  /**
   * Given the ids visible on the next page, return only those not yet
   * resolved (as either found or not-found). Deduplicates the input.
   */
  selectUnresolved(input: {
    paperIds: Iterable<Id<"extractionPapers">>;
    openalexIds: Iterable<string>;
    jobIds: Iterable<Id<"extractionJobs">>;
  }): {
    paperIds: Id<"extractionPapers">[];
    openalexIds: string[];
    jobIds: Id<"extractionJobs">[];
  };
}

export function createEnrichmentCache(): EnrichmentCache {
  const papers = new Map<Id<"extractionPapers">, string | null>();
  const papersByOpenalex = new Map<string, string | null>();
  const jobs = new Map<Id<"extractionJobs">, string | null>();

  return {
    getPaperTitle(id) {
      return papers.has(id) ? papers.get(id)! : undefined;
    },
    getPaperTitleByOpenalex(id) {
      return papersByOpenalex.has(id) ? papersByOpenalex.get(id)! : undefined;
    },
    getJobName(id) {
      return jobs.has(id) ? jobs.get(id)! : undefined;
    },
    recordPaperResolved(id, title) {
      papers.set(id, title);
    },
    recordPaperNotFound(id) {
      papers.set(id, null);
    },
    recordPaperByOpenalexResolved(id, title) {
      papersByOpenalex.set(id, title);
    },
    recordPaperByOpenalexNotFound(id) {
      papersByOpenalex.set(id, null);
    },
    recordJobResolved(id, name) {
      jobs.set(id, name);
    },
    recordJobNotFound(id) {
      jobs.set(id, null);
    },
    selectUnresolved(input) {
      const paperIds: Id<"extractionPapers">[] = [];
      const seenPaper = new Set<Id<"extractionPapers">>();
      for (const id of input.paperIds) {
        if (seenPaper.has(id)) continue;
        seenPaper.add(id);
        if (!papers.has(id)) paperIds.push(id);
      }
      const openalexIds: string[] = [];
      const seenOpenalex = new Set<string>();
      for (const id of input.openalexIds) {
        if (seenOpenalex.has(id)) continue;
        seenOpenalex.add(id);
        if (!papersByOpenalex.has(id)) openalexIds.push(id);
      }
      const jobIds: Id<"extractionJobs">[] = [];
      const seenJob = new Set<Id<"extractionJobs">>();
      for (const id of input.jobIds) {
        if (seenJob.has(id)) continue;
        seenJob.add(id);
        if (!jobs.has(id)) jobIds.push(id);
      }
      return { paperIds, openalexIds, jobIds };
    },
  };
}
