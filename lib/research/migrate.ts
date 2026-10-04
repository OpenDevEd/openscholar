import type { ConvexReactClient } from "convex/react";
import { api } from "../../convex/_generated/api";
import { localKeywordExpansionStore, localRatingsStore, localSearchHistoryStore } from "../store";
import { importSearchRecord, serializeSearch } from "./records";
import type { QueryHistoryEntry, QuestionHistoryEntry, SearchResult } from "../types";

const CLAIMS_KEY = "research-import-owners";
type ImportBatch = { accountId: string; searches: Array<{ search: ReturnType<typeof serializeSearch>; history: { queryHistory: QueryHistoryEntry[]; questionHistory: QuestionHistoryEntry[] } }>; shortcuts: Array<{ shorthand: string; expansion: string; createdAt: number }>; ratings: Array<{ paperId: string; rating: number }> };
type LocalItem = { key: string; add: (batch: ImportBatch) => void; acknowledge: () => void; bytes: number };

export class ResearchImportError extends Error {
  constructor(readonly count: number) { super(`${count} local research records could not be imported. Your local copies have been kept. Retry or download a backup.`); }
}

export function localResearchBackup() {
  return JSON.stringify({ searches: localSearchHistoryStore.getState().searchHistory, shortcuts: localKeywordExpansionStore.getState().keywords, ratings: localRatingsStore.getState().ratings }, null, 2);
}

/** Ownership survives an interrupted import and an intervening account switch. */
/** The history a search held in this browser carries. */
const historyOf = (search: SearchResult) => ({ queryHistory: search.queryHistory ?? [], questionHistory: search.questionHistory ?? [] });

export async function importLocalResearch(
  accountId: string,
  send: (batch: ImportBatch) => Promise<null>,
  active: () => boolean,
) {
  const failures: unknown[] = [];
  // Persist an identity for records made by old versions before claiming them.
  localSearchHistoryStore.setState(state => ({ searchHistory: state.searchHistory.map(search => {
    if (search.id) return search;
    try {
      return { ...importSearchRecord(search as unknown as Record<string, unknown>), screeningResponses: search.screeningResponses ?? {}, chatJobIdsByAccountId: search.chatJobIdsByAccountId };
    } catch (error) { failures.push(error); return search; }
  }) }));
  const claims = JSON.parse(localStorage.getItem(CLAIMS_KEY) ?? "{}") as Record<string, string>;
  const items: LocalItem[] = [];
  for (const search of localSearchHistoryStore.getState().searchHistory) {
    if (!search.id) continue;
    try {
    const data = serializeSearch(search);
    const serialized = JSON.stringify(data);
    // The history this browser kept goes with it, to the search's history rows.
    const history = historyOf(search);
    // A search whose history changed while it was sent stays, to be sent again.
    const sentHistory = JSON.stringify(history);
    items.push({
      key: `search:${search.id}`, bytes: (serialized.length + sentHistory.length) * 2,
      add: batch => batch.searches.push({ search: data, history }),
      acknowledge: () => localSearchHistoryStore.setState(state => ({ searchHistory: state.searchHistory.filter(current => current.id !== search.id || JSON.stringify(serializeSearch(current)) !== serialized || JSON.stringify(historyOf(current)) !== sentHistory) })),
    });
    } catch (error) { failures.push(error); }
  }
  for (const [shorthand, value] of Object.entries(localKeywordExpansionStore.getState().keywords)) {
    items.push({
      key: `shortcut:${shorthand}`, bytes: JSON.stringify(value).length * 2,
      add: batch => batch.shortcuts.push({ shorthand, ...value }),
      acknowledge: () => localKeywordExpansionStore.setState(state => ({ keywords: Object.fromEntries(Object.entries(state.keywords).filter(([key, current]) => key !== shorthand || JSON.stringify(current) !== JSON.stringify(value))) })),
    });
  }
  for (const [paperId, rating] of Object.entries(localRatingsStore.getState().ratings)) {
    items.push({
      key: `rating:${paperId}`, bytes: paperId.length * 2 + 32,
      add: batch => batch.ratings.push({ paperId, rating }),
      acknowledge: () => localRatingsStore.setState(state => ({ ratings: Object.fromEntries(Object.entries(state.ratings).filter(([key, current]) => key !== paperId || current !== rating)) })),
    });
  }
  const owned = items.filter(item => !claims[item.key] || claims[item.key] === accountId);
  for (const item of owned) claims[item.key] = accountId;
  if (owned.length) localStorage.setItem(CLAIMS_KEY, JSON.stringify(claims));
  for (let offset = 0; offset < owned.length;) {
    if (!active()) return failures;
    const batch: ImportBatch = { accountId, searches: [], shortcuts: [], ratings: [] };
    const pending: LocalItem[] = [];
    let bytes = 0;
    while (offset < owned.length && pending.length < 25) {
      const item = owned[offset];
      if (pending.length && bytes + item.bytes > 500_000) break;
      item.add(batch); pending.push(item); bytes += item.bytes; offset++;
    }
    const acknowledged: LocalItem[] = [];
    try { await send(batch); acknowledged.push(...pending); }
    catch (error) {
      if (pending.length === 1) failures.push(error);
      else for (const item of pending) {
        if (!active()) return failures;
        const single: ImportBatch = { accountId, searches: [], shortcuts: [], ratings: [] };
        item.add(single);
        try { await send(single); acknowledged.push(item); } catch (cause) { failures.push(cause); }
      }
    }
    // Another tab may have added local data while this batch was in flight.
    await Promise.all([localSearchHistoryStore.persist.rehydrate(), localKeywordExpansionStore.persist.rehydrate(), localRatingsStore.persist.rehydrate()]);
    // A successful mutation acknowledges persistence even if the account switched.
    for (const item of acknowledged) item.acknowledge();
    const remaining = new Set([
      ...localSearchHistoryStore.getState().searchHistory.map(row => `search:${row.id}`),
      ...Object.keys(localKeywordExpansionStore.getState().keywords).map(key => `shortcut:${key}`),
      ...Object.keys(localRatingsStore.getState().ratings).map(key => `rating:${key}`),
    ]);
    const latestClaims = JSON.parse(localStorage.getItem(CLAIMS_KEY) ?? "{}") as Record<string, string>;
    for (const item of acknowledged) if (!remaining.has(item.key)) delete latestClaims[item.key];
    localStorage.setItem(CLAIMS_KEY, JSON.stringify(latestClaims));
  }
  return failures;
}

export function migrateLocalResearch(client: ConvexReactClient, accountId: string, active: () => boolean) {
  return importLocalResearch(accountId, batch => client.mutation(api.research.records.importBatch, batch), active);
}
