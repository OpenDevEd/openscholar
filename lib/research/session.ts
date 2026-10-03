import { createStore, type StoreApi } from "zustand/vanilla";
import type { ConvexReactClient } from "convex/react";
import type { FunctionReference } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { SearchHistoryState, KeywordExpansionState, RatingsState } from "../store";
import type { SearchResult, BookmarkData } from "../types";
import { applySearchEdit, historySummary, importSearchRecord, RATED_PAPERS_MAX, restoreSearch, serializeResponses, serializeSearch, serializeSearchPatch, type ResearchCommand, type SavedSearch, type SearchEdit } from "./records";
import { activateResearch, type ResearchStores } from "./binding";
import { migrateLocalResearch, ResearchImportError } from "./migrate";

type Page<T> = { page: T[]; isDone: boolean; continueCursor: string };
type PageQuery<T> = FunctionReference<"query", "public", { accountId: string; paginationOpts: { cursor: string | null; numItems: number } }, Page<T>>;
type Shortcut = { shorthand: string; expansion: string; createdAt: number };
type Rating = { paperId: string; rating: number };
type Data = { shortcuts: Shortcut[] };
type Subscription<T> = { localQueryResult: () => T | undefined; onUpdate: (callback: () => void) => () => void };
/** A read a page holds open: who wants it, how it's opened, what Convex has (undefined while loading), and whether it failed. */
type Watch<T> = { readers: Set<() => void>; open: () => Subscription<T>; stop: () => void; value: T | undefined; failed: boolean };
export type WatchedStatus = "loading" | "found" | "missing" | "failed";

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
  private data: Data = { shortcuts: [] };
  private loaded = new Set<keyof Data>();
  // Only the searches pages read by ID; lists page through `listedSearches` themselves (#420).
  private watched = new Map<string, Watch<SavedSearch | null>>();
  // Only the ratings of the papers pages show, read by paper ID, up to RATED_PAPERS_MAX a read;
  // `ratedBy` says which read has each paper.
  private rated = new Map<string, Watch<Page<Rating>>>();
  private ratedBy = new Map<string, string>();
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
      removeQueryHistoryEntry: (id, entry) => edit(id, { kind: "removeQueryHistoryEntry", query: entry.query, ...(entry.field ? { field: entry.field } : {}), timestamp: entry.timestamp }),
      copySearch: (id, source, updates) => {
        edit(id, { ...serializeSearchPatch(updates), kind: "copySearch", from: source.id, fromUpdatedAt: source.updatedAt, summary: { queryHistoryCount: source.queryHistoryCount, questionCount: source.questionCount, ...(source.latestQuestion === undefined ? {} : { latestQuestion: source.latestQuestion }), questionText: source.questionText } });
      },
      addScreeningQuestion: (id, question) => edit(id, { kind: "addScreeningQuestion", question }),
      updateScreeningQuestion: (id, index, updates) => { if (updates.question !== undefined) replaceQuestion(id, index, updates.question); },
      removeScreeningQuestion: (id, index) => replaceQuestion(id, index, null),
      clearScreeningQuestions: id => edit(id, { kind: "clearScreeningQuestions" }),
      setScreeningResponse: (id, paperId, question, response) => edit(id, { kind: "responses", paperId, responses: [{ question, response }], by: "person" }),
      setScreeningResponses: (id, paperId, responses, confidences) => edit(id, {
        kind: "responses", paperId, by: "model",
        responses: serializeResponses(responses).map((value) => (confidences?.[value.question] === undefined ? value : { ...value, confidence: confidences[value.question] })),
      }),
      getScreeningResponse: (id, paperId, question) => current(id)?.screeningResponses[paperId]?.[question],
      clearScreeningResponses: (id, paperId) => edit(id, { kind: "clearResponses", ...(paperId === undefined ? {} : { paperId }) }),
      removeScreeningQuestionFromAllPapers: (id, question) => edit(id, { kind: "removeQuestionResponses", question }),
      getSearchResult: current,
      removeSearchResult: id => this.dispatch({ kind: "deleteSearch", id }),
      // On the server, a batch at a time: the browser holds only the searches it shows.
      clearSearchHistory: () => { void this.client.mutation(api.research.records.clearSearches, { accountId: this.accountId }).catch(this.fail); },
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
      readRatings: async paperIds => {
        const ids = [...new Set(paperIds)];
        const reads = Array.from({ length: Math.ceil(ids.length / RATED_PAPERS_MAX) }, (_, i) => ids.slice(i * RATED_PAPERS_MAX, (i + 1) * RATED_PAPERS_MAX));
        const pages = await Promise.all(reads.map(chunk => this.client.query(api.research.records.ratingsOf, { accountId: this.accountId, paperIds: chunk })));
        const read = Object.fromEntries(pages.flatMap(page => page.page).map(row => [row.paperId, row.rating]));
        // A rating still being saved counts as the person left it.
        for (const { command } of this.pending) {
          if (command.kind !== "rating" || !ids.includes(command.paperId)) continue;
          if (command.rating === null) delete read[command.paperId]; else read[command.paperId] = command.rating;
        }
        return read;
      },
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
    this.snapshot = { ...this.snapshot, ready: this.imported && this.loaded.size === Object.keys(this.data).length, pending: this.pending.length };
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
  private watches(): Array<Watch<unknown>> { return [...this.watched.values(), ...this.rated.values()]; }
  /** Whether a read is still on its way: a following page, or a search or ratings a page just asked for. */
  private reading() { return this.unsettled.size > 0 || this.watches().some(({ value, failed }) => value === undefined && !failed); }
  private settle() { if (!this.reading()) this.releaseSettled(); }
  retry = () => {
    this.snapshot = { ...this.snapshot, error: null };
    this.notify();
    for (const entry of this.watches()) {
      if (!entry.failed) continue;
      entry.stop();
      entry.failed = false;
      for (const notify of entry.readers) notify();
      this.read(entry);
    }
    if (this.enabled) { void this.import(this.epoch); void this.pump(); }
  };
  private start() {
    const epoch = ++this.epoch;
    this.stops.push(activateResearch(this.stores));
    if (!this.enabled) return;
    void this.connect(epoch);
  }
  /**
   * Reads search `id` while `reader` wants it, so `getSearchResult(id)` has it; returns the
   * unsubscribe. A search this browser just created is there before Convex has it, and so
   * is one a list already shows (`known`, without its screening answers) until it's read.
   */
  watchSearch = (id: string, reader: () => void, known?: SavedSearch) => {
    const open = () => this.client.watchQuery(api.research.records.getSearch, { accountId: this.accountId, id });
    return this.hold(this.watched, id, open, reader, known);
  };
  /**
   * Reads the person's ratings of these papers while `reader` wants them, so the ratings
   * store has them; returns the unsubscribe. A paper another read already has stays with that
   * read, and the rest are read up to RATED_PAPERS_MAX at a time, so a list that grows reads
   * only the papers it gained.
   */
  watchRatings = (paperIds: string[], reader: () => void) => {
    const ids = [...new Set(paperIds)];
    const fresh = ids.filter(id => !this.ratedBy.has(id));
    const stops = [...new Set(ids.flatMap(id => this.ratedBy.get(id) ?? []))].map(key => this.hold(this.rated, key, this.rated.get(key)!.open, reader));
    for (let start = 0; start < fresh.length; start += RATED_PAPERS_MAX) {
      const chunk = fresh.slice(start, start + RATED_PAPERS_MAX);
      const key = chunk.join("\n");
      for (const id of chunk) this.ratedBy.set(id, key);
      const open = () => this.client.watchQuery(api.research.records.ratingsOf, { accountId: this.accountId, paperIds: chunk });
      stops.push(this.hold(this.rated, key, open, reader, undefined, () => { for (const id of chunk) this.ratedBy.delete(id); }));
    }
    return () => { for (const stop of stops) stop(); };
  };
  /** How many of these papers, from the first, have their ratings read, or a read that failed. */
  ratingsRead = (paperIds: string[]) => {
    const read = paperIds.findIndex(id => {
      const entry = this.rated.get(this.ratedBy.get(id) ?? "");
      return !entry || (entry.value === undefined && !entry.failed);
    });
    return read === -1 ? paperIds.length : read;
  };
  /**
   * Opens the read under `key` if no one holds it yet, and holds it for `reader`; returns the
   * release. A read no one holds is closed a moment later, not at once, so a list that changes
   * what it reads can take over the reads it keeps.
   */
  private hold<T>(reads: Map<string, Watch<T>>, key: string, open: () => Subscription<T>, reader: () => void, known?: T, closed: () => void = () => {}) {
    let entry = reads.get(key);
    if (!entry) {
      const opened: Watch<T> = { readers: new Set(), open, stop: () => {}, value: known, failed: false };
      reads.set(key, (entry = opened));
      this.read(opened);
      if (known !== undefined && opened.value === known) this.render();
    }
    const held = entry;
    held.readers.add(reader);
    return () => {
      held.readers.delete(reader);
      queueMicrotask(() => {
        if (held.readers.size || reads.get(key) !== held) return;
        held.stop();
        reads.delete(key);
        closed();
        this.render();
        this.settle();
      });
    };
  }
  /** Subscribes `entry` to its read. A read that fails stops being waited for, and Retry reads it again. */
  private read<T>(entry: Watch<T>) {
    const subscription = entry.open();
    const update = () => {
      try {
        const value = subscription.localQueryResult();
        if (value === undefined || (value === entry.value && !entry.failed)) return;
        entry.value = value;
        entry.failed = false;
        this.render();
      } catch (error) {
        entry.failed = true;
        this.fail(error);
      }
      for (const notify of entry.readers) notify();
      this.settle();
    };
    entry.stop = subscription.onUpdate(update);
    update();
  }
  /** Whether the account has search `id`, reading it once when no page is. */
  hasSearch = async (id: string) =>
    this.watchedStatus(id) === "found" || (await this.client.query(api.research.records.getSearch, { accountId: this.accountId, id })) !== null;
  watchedStatus = (id: string): WatchedStatus => {
    if (this.pending.some(({ command }) => command.kind === "createSearch" && command.search.id === id)) return "found";
    const watched = this.watched.get(id);
    if (watched?.value === undefined) return watched?.failed ? "failed" : "loading";
    return watched.value === null ? "missing" : "found";
  };
  private connect(epoch: number) {
    const receive = <K extends keyof Data>(key: K) => (value: Data[K]) => {
      if (epoch !== this.epoch) return;
      this.data[key] = value; this.loaded.add(key); this.render(); this.notify();
      this.unsettled.delete(key);
      this.settle();
    };
    this.stops.push(
      watchPages(this.client, api.research.records.shortcuts, this.accountId, receive("shortcuts"), this.fail, () => this.unsettled.add("shortcuts")),
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
          // Mutation completion includes live-query updates, but a changed cursor may still
          // be fetching the following page, and a page that just opened a new search may
          // still be reading it. Keep optimism until they arrive.
          if (this.epoch === epoch && this.reading()) await new Promise<void>(resolve => this.settledListeners.add(resolve));
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
    let searches = [...this.watched.values()].flatMap(({ value }) => (value ? [value] : []));
    const keywords = Object.fromEntries(this.data.shortcuts.map(({ shorthand, ...value }) => [shorthand, value]));
    const ratings = Object.fromEntries([...this.rated.values()].flatMap(({ value }) => value?.page ?? []).map(row => [row.paperId, row.rating]));
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
