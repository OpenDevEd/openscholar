import "server-only";
// MOCK (mock/publish-reports): topics for a report, as the topics most common among the OpenAlex works that best match
// its title. The real build asks the metadata model for them.
import { openAlexFetch } from "@/lib/openalex/fetch";
import { openAlexUrl } from "@/lib/openalex/request-url";
import type { Topic } from "./types";

const SAMPLE = 25;

/** Up to `limit` topics, best first; a topic's score is the share of the matching works that have it. */
export async function suggestTopics(text: string, limit = 4): Promise<Topic[]> {
  try {
    const response = await openAlexFetch(openAlexUrl("works", { search: text.slice(0, 400), "per-page": String(SAMPLE), select: "topics" }), { timeoutMs: 12000 });
    if (!response.ok) throw new Error(`OpenAlex works ${response.status}`);
    const { results } = (await response.json()) as { results: Array<{ topics?: Array<{ id: string; display_name: string }> }> };
    const counts = new Map<string, { name: string; n: number }>();
    for (const work of results) for (const topic of (work.topics ?? []).slice(0, 3)) {
      const id = topic.id.split("/").at(-1)!;
      counts.set(id, { name: topic.display_name, n: (counts.get(id)?.n ?? 0) + 1 });
    }
    return [...counts].sort((a, b) => b[1].n - a[1].n).slice(0, limit).map(([id, { name, n }]) => ({ id, name, score: Math.round((n / Math.max(results.length, 1)) * 100) / 100 }));
  } catch (error) {
    console.error("[publish mock] topic suggestions failed", error);
    return [];
  }
}
