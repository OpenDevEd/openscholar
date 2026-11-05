/** What it takes of an author's record to add one person up. */
type AuthorRecord = {
  ids?: { openalex?: string | null } | null;
  orcid?: string | null;
  works_count?: number | null;
  cited_by_count?: number | null;
  summary_stats?: { h_index?: number | null } | null;
  topics?: Array<{ id?: string; display_name?: string; count?: number | null }> | null;
};

/** The records our index pairs with an OpenAlex author. Its filter also finds records paired with someone else, whose name is close: they aren't this person. */
export const pairedRecords = <Record extends AuthorRecord>(id: string, records: Record[]) => records.filter((record) => record.ids?.openalex?.split("/").at(-1) === id);

/** One person from their records: the largest speaks for them, and their counts and topics are added up. */
export function wholePerson<Record extends AuthorRecord>(records: Record[]): Record {
  const largest = records.reduce((best, record) => ((record.works_count ?? 0) > (best.works_count ?? 0) ? record : best));
  const topics = new Map<string, { id: string; display_name: string; count: number }>();
  for (const topic of records.flatMap((record) => record.topics ?? [])) {
    if (!topic.id || !topic.display_name) continue;
    const known = topics.get(topic.id);
    topics.set(topic.id, { id: topic.id, display_name: topic.display_name, count: (known?.count ?? 0) + (topic.count ?? 0) });
  }
  return {
    ...largest,
    orcid: records.find((record) => record.orcid)?.orcid ?? null,
    works_count: records.reduce((sum, record) => sum + (record.works_count ?? 0), 0),
    cited_by_count: records.reduce((sum, record) => sum + (record.cited_by_count ?? 0), 0),
    // ponytail: the largest record's h-index, a floor for the person's. The true one takes reading their papers' citations together, too much for a hover card.
    summary_stats: { h_index: Math.max(...records.map((record) => record.summary_stats?.h_index ?? 0)) },
    topics: [...topics.values()].sort((a, b) => b.count - a.count),
  };
}
