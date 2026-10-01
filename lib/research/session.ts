import { createStore, type StoreApi } from "zustand/vanilla";
import type { ConvexReactClient } from "convex/react";
import type { FunctionReference } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { SearchHistoryState, KeywordExpansionState, RatingsState } from "../store";
import type { SearchResult, BookmarkData } from "../types";
import { applySearchEdit, historySummary, importSearchRecord, restoreSearch, serializeResponses, serializeSearch, serializeSearchPatch, type ResearchCommand, type SavedSearch, type SearchEdit } from "./records";
import { activateResearch, type ResearchStores } from "./binding";
import { migrateLocalResearch, ResearchImportError } from "./migrate";

type Page<T> = { page: T[]; isDone: boolean; continueCursor: string };
type PageQuery<T> = FunctionReference<"query", "public", { accountId: string; paginationOpts: { cursor: string | null; numItems: number } }, Page<T>>;
type Shortcut = { shorthand: string; expansion: string; createdAt: number };
type Rating = { paperId: string; rating: number };
type Data = { searches: SavedSearch[]; shortcuts: Shortcut[]; ratings: Rating[] };

/** Each live query is bounded. A changed cursor replaces only the following pages. */
export function watchPages<T>(client: ConvexReactClient, query: PageQuery<T>, accountId: string, publish: (rows: T[]) => void, fail: (error: unknown) => void, loading: () => void = () => {}) {
  const pages: Array<{ cursor: string | null; value?: Page<T>; stop: () => void }> = [];
  let stopped = false;
  function trim(index: number) { for (const page of pages.splice(index)) page.stop(); }
  function watch(index: number, cursor: string | null) {
    loading();
    const subscription = client.watchQuery(query, { accountId, paginationOpts: { cursor, numItems: 25 } });
    const page: typeof pages[number] = { cursor, stop: () => {} };
    pages[index] = page;
    const update = () => {
      if (stopped || pages[index] !== page) return;
      try {
        const value = subscription.localQueryResult();
        if (!value) return;
        page.value = value;
        if (value.isDone) {
          trim(index + 1);
          publish(pages.flatMap(part => part.value?.page ?? []));
        } else if (pages[index + 1]?.cursor !== value.continueCursor) {
          trim(index + 1);
          watch(index + 1, value.continueCursor);
        } else if (pages.at(-1)?.value?.isDone) {
          publish(pages.flatMap(part => part.value?.page ?? []));
        }
      } catch (error) { fail(error); }
    };
    page.stop = subscription.onUpdate(update);
    update();
  }
  watch(0, null);
  return () => { stopped = true; trim(0); };
}

function newSearch(input: Parameters<SearchHistoryState["addSearchResult"]>[0]): SearchResult {
  const now = new Date().toISOString();
  const queryHistory = [{ query: input.query, field: input.field, timestamp: now }];
  const questionHistory = input.questionHistory ?? [];
  return { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now,
    queryHistory, questionHistory, ...historySummary(queryHistory, questionHistory), screeningQuestions: [], screeningResponses: {} };
}

/** A search to create on the account, with the history it starts with. */
function createSearch(search: SearchResult): ResearchCommand {
  return { kind: "createSearch", search: serializeSearch(search), history: { queryHistory: search.queryHistory ?? [], questionHistory: search.questionHistory ?? [] } };
}

function expand(query: string, keywords: Record<string, BookmarkData>) {
  const warnings: Array<{ key: string; params: Record<string, string> }> = [];
  const expandedQuery = query.replace(/(\w[\w-]*)\.\.\./g, (match, keyword: string) => {
    if (keywords[keyword]?.expansion) return keywords[keyword].expansion;
    warnings.push({ key: "bookmarkNotFound", params: { keyword } });
    return match;
  });
  return { expandedQuery, warnings };
}

export class ResearchSession {
  readonly stores: ResearchStores;
  private data: Data = { searches: [], shortcuts: [], ratings: [] };
  private loaded = new Set<keyof Data>();
  private pending: Array<{ requestId: string; command: ResearchCommand }> = [];
  private listeners = new Set<() => void>();
  private stops: Array<() => void> = [];
  private epoch = 0;
  private pumping = false;
  private imported = false;
  private enabled = false;
  private unsettled = new Set<keyof Data>();
  private settledListeners = new Set<() => void>();
  private snapshot = { ready: false, error: null as Error | null, pending: 0 };

  constructor(private client: ConvexReactClient, readonly accountId: string, private onError: (error: Error, retry: () => void) => void = () => {}) {
    const edit = (id: string, value: SearchEdit) => this.dispatch({ kind: "editSearch", id, edit: value });
    const current = (id: string) => this.stores.history.getState().searchHistory.find(row => row.id === id);
    const replaceQuestion = (id: string, index: number, replacement: string | null) => {
      const question = current(id)?.screeningQuestions[index]?.question;
      if (question !== undefined) edit(id, { kind: "replaceScreeningQuestion", question, replacement });
    };
    const history = createStore<SearchHistoryState>(() => ({
      searchHistory: [],
      addSearchResult: input => { const search = newSearch(input); this.dispatch(createSearch(search)); return search.id; },
      updateSearchResult: (id, updates) => edit(id, serializeSearchPatch(updates)),
      addQueryToHistory: (id, query, field) => edit(id, { kind: "query", query, field }),
      addQuestionToHistory: (id, question) => edit(id, { kind: "question", question }),
      removeQueryHistoryEntry: (id, entry) => edit(id, { kind: "removeQueryHistoryEntry", query: entry.query, timestamp: entry.timestamp }),
      copySearch: (id, from, updates) => {
        const source = current(from);
        if (source) edit(id, { ...serializeSearchPatch(updates), kind: "copySearch", from, fromUpdatedAt: source.updatedAt, summary: { queryHistoryCount: source.queryHistoryCount, questionCount: source.questionCount, ...(source.latestQuestion === undefined ? {} : { latestQuestion: source.latestQuestion }), questionText: source.questionText } });
      },
      addScreeningQuestion: (id, question) => edit(id, { kind: "addScreeningQuestion", question }),
      updateScreeningQuestion: (id, index, updates) => { if (updates.question !== undefined) replaceQuestion(id, index, updates.question); },
      removeScreeningQuestion: (id, index) => replaceQuestion(id, index, null),
      clearScreeningQuestions: id => edit(id, { kind: "clearScreeningQuestions" }),
      setScreeningResponse: (id, paperId, question, response) => edit(id, { kind: "responses", paperId, responses: [{ question, response }], by: "person" }),
      setScreeningResponses: (id, paperId, responses) => edit(id, { kind: "responses", paperId, responses: serializeResponses(responses), by: "model" }),
      getScreeningResponse: (id, paperId, question) => current(id)?.screeningResponses[paperId]?.[question],
      clearScreeningResponses: (id, paperId) => edit(id, { kind: "clearResponses", ...(paperId === undefined ? {} : { paperId }) }),
      removeScreeningQuestionFromAllPapers: (id, question) => edit(id, { kind: "removeQuestionResponses", question }),
      getSearchResult: current,
      removeSearchResult: index => { const search = history.getState().searchHistory[index]; if (search) this.dispatch({ kind: "deleteSearch", id: search.id }); },
      clearSearchHistory: () => { for (const search of history.getState().searchHistory) this.dispatch({ kind: "deleteSearch", id: search.id }); },
      migrateSearchResult: search => search.id,
      importSearchHistory: rows => {
        for (const row of rows) {
          this.dispatch(createSearch(importSearchRecord(row)));
        }
        return rows.length;
      },
    }));
    const shortcuts: StoreApi<KeywordExpansionState> = createStore<KeywordExpansionState>(() => ({
      keywords: {},
      addKeyword: (shorthand, expansion) => { if (!shortcuts.getState().keywords[shorthand]) this.dispatch({ kind: "shortcut", shorthand, value: { expansion, createdAt: Date.now() } }); },
      updateKeyword: (shorthand, expansion) => this.dispatch({ kind: "shortcut", shorthand, value: { expansion, createdAt: shortcuts.getState().keywords[shorthand]?.createdAt ?? Date.now() } }),
      removeKeyword: shorthand => this.dispatch({ kind: "shortcut", shorthand, value: null }),
      clearKeywords: () => { for (const shorthand of Object.keys(shortcuts.getState().keywords)) this.dispatch({ kind: "shortcut", shorthand, value: null }); },
      expandQuery: query => expand(query, shortcuts.getState().keywords),
      importKeywords: rows => {
        let imported = 0;
        for (const row of rows) {
          const shorthand = String(row.name ?? row.shorthand ?? "");
          if (!shorthand || !row.expansion || shortcuts.getState().keywords[shorthand]) continue;
          this.dispatch({ kind: "shortcut", shorthand, value: { expansion: String(row.expansion), createdAt: typeof row.createdAt === "number" ? row.createdAt : Date.now() } });
          imported++;
        }
        return imported;
      },
    }));
    const ratings = createStore<RatingsState>(() => ({
      ratings: {},
      setRating: (paperId, rating) => this.dispatch({ kind: "rating", paperId, rating }),
      clearRatings: () => { for (const paperId of Object.keys(ratings.getState().ratings)) this.dispatch({ kind: "rating", paperId, rating: null }); },
    }));
    this.stores = { history, shortcuts, ratings };
  }

  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => this.snapshot;
  subscribe = (listener: () => void, enabled = true, onError = this.onError) => {
    this.enabled = enabled;
    this.onError = onError;
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) { this.epoch++; for (const stop of this.stops.splice(0)) stop(); this.releaseSettled(); }
    };
  };
  private notify() {
    this.snapshot = { ...this.snapshot, ready: this.imported && this.loaded.size === 3, pending: this.pending.length };
    if (typeof window !== "undefined") {
      if (this.pending.length) window.addEventListener("beforeunload", this.beforeUnload);
      else window.removeEventListener("beforeunload", this.beforeUnload);
    }
    for (const listener of this.listeners) listener();
  }
  private fail = (cause: unknown) => {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    this.snapshot = { ...this.snapshot, error };
    this.notify(); this.onError(error, this.retry);
  };
  private beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
  private releaseSettled() { for (const resolve of this.settledListeners) resolve(); this.settledListeners.clear(); }
  retry = () => {
    this.snapshot = { ...this.snapshot, error: null };
    this.notify();
    if (this.enabled) { void this.import(this.epoch); void this.pump(); }
  };
  private start() {
    const epoch = ++this.epoch;
    this.stops.push(activateResearch(this.stores));
    if (!this.enabled) return;
    void this.connect(epoch);
  }
  private connect(epoch: number) {
    const receive = <K extends keyof Data>(key: K) => (value: Data[K]) => {
      if (epoch !== this.epoch) return;
      this.data[key] = value; this.loaded.add(key); this.render(); this.notify();
      this.unsettled.delete(key);
      if (!this.unsettled.size) this.releaseSettled();
    };
    this.stops.push(
      watchPages(this.client, api.research.records.searches, this.accountId, receive("searches"), this.fail, () => this.unsettled.add("searches")),
      watchPages(this.client, api.research.records.shortcuts, this.accountId, receive("shortcuts"), this.fail, () => this.unsettled.add("shortcuts")),
      watchPages(this.client, api.research.records.ratings, this.accountId, receive("ratings"), this.fail, () => this.unsettled.add("ratings")),
    );
    void this.import(epoch);
  }
  private async import(epoch: number) {
    if (!this.accountId) return;
    try {
      const failures = await migrateLocalResearch(this.client, this.accountId, () => this.epoch === epoch);
      if (this.epoch !== epoch) return;
      this.imported = true; this.notify(); void this.pump();
      if (failures.length) this.fail(new ResearchImportError(failures.length));
    } catch (error) { if (this.epoch === epoch) this.fail(error); }
  }
  private dispatch(command: ResearchCommand) {
    this.pending.push({ requestId: crypto.randomUUID(), command });
    this.render(); this.notify(); void this.pump();
  }
  private async pump() {
    if (this.pumping || !this.imported || !this.enabled || !this.listeners.size) return;
    this.pumping = true;
    const epoch = this.epoch;
    try {
      while (this.pending.length && this.epoch === epoch) {
        const next = this.pending[0];
        try {
          await this.client.mutation(api.research.records.change, { accountId: this.accountId, ...next });
          // Mutation completion includes live-query updates, but a changed cursor
          // may still be fetching the following page. Keep optimism until it arrives.
          if (this.epoch === epoch && this.unsettled.size) await new Promise<void>(resolve => this.settledListeners.add(resolve));
          this.pending.shift();
        } catch (error) {
          if (this.epoch !== epoch) break;
          // Convex retries network interruptions itself. A rejected mutation is a
          // server error; roll it back so it cannot block unrelated later saves.
          this.pending.shift();
          this.fail(error);
        }
        this.render(); this.notify();
      }
    } catch (error) { if (this.epoch === epoch) this.fail(error); }
    finally {
      this.pumping = false;
      if (this.epoch !== epoch && this.listeners.size) void this.pump();
    }
  }
  private render() {
    let searches = this.data.searches;
    const keywords = Object.fromEntries(this.data.shortcuts.map(({ shorthand, ...value }) => [shorthand, value]));
    const ratings = Object.fromEntries(this.data.ratings.map(row => [row.paperId, row.rating]));
    for (const { command } of this.pending) {
      switch (command.kind) {
        case "createSearch": if (!searches.some(row => row.id === command.search.id)) searches = [command.search, ...searches]; break;
        case "deleteSearch": searches = searches.filter(row => row.id !== command.id); break;
        case "editSearch": searches = searches.map(row => {
          if (row.id !== command.id) return row;
          const edit = command.edit;
          if (edit.kind === "query" && row.query === edit.query && row.field === edit.field) return row;
          if (edit.kind === "question" && row.latestQuestion === edit.question) return row;
          if (edit.kind === "addScreeningQuestion" && row.screeningQuestions.some(q => q.question === edit.question)) return row;
          return applySearchEdit(row, edit, row.updatedAt);
        }); break;
        case "shortcut": if (command.value) keywords[command.shorthand] = command.value; else delete keywords[command.shorthand]; break;
        case "rating": if (command.rating === null) delete ratings[command.paperId]; else ratings[command.paperId] = command.rating;
      }
    }
    this.stores.history.setState({ searchHistory: searches.map(restoreSearch) });
    this.stores.shortcuts.setState({ keywords });
    this.stores.ratings.setState({ ratings });
  }
}
