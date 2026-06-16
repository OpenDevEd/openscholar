import { hashSearchFilters } from "@/lib/openalex/filter-hash";

type SearchFiltersForFingerprint = Parameters<typeof hashSearchFilters>[0];

export function buildChatSourceFingerprint({
  searchFilters,
  limit,
}: {
  searchFilters: SearchFiltersForFingerprint;
  limit: number;
}): string {
  return `openalex:${hashSearchFilters(searchFilters)}:${limit}`;
}
