import { createStore, type StoreApi } from "zustand/vanilla";
import type { ConvexReactClient } from "convex/react";
import { api } from "../../convex/_generated/api";
import { shortcutExpansions, type SearchHistoryState, type KeywordExpansionState, type RatingsState } from "../store";
import type { SearchResult } from "../types";
import { expandShortcuts } from "../query-shortcuts";
import { applySearchEdit, historySummary, importSearchRecord, RATED_PAPERS_MAX, SHORTCUT_NAMES_MAX, restoreSearch, serializeResponses, serializeSearch, serializeSearchPatch, type ResearchCommand, type SavedSearch, type SearchEdit } from "./records";
import { activateResearch, type ResearchStores } from "./binding";
import { migrateLocalResearch, ResearchImportError } from "./migrate";

type Page<T> = { page: T[]; isDone: boolean; continueCursor: string };
type Shortcut = { shorthand: string; expansion: string; createdAt: number };
type Rating = { paperId: string; rating: number };
/** A set of reads by ID: each read under the IDs it takes, and which read has each ID. */
type ReadsById<T> = { reads: Map<string, Watch<Page<T>>>; by: Map<string, string> };
/** How long shortcuts read for a single action stay read, for the code after it to expand with. */
const ENSURE_MS = 10_000;
type Subscription<T> = { localQueryResult: () => T | undefined; onUpdate: (callback: () => void) => () => void };
/** A read a page holds open: who wants it, how it's opened, what Convex has (undefined while loading), and whether it failed. */
type Watch<T> = { readers: Set<() => void>; open: () => Subscription<T>; stop: () => void; value: T | undefined; failed: boolean };
export type WatchedStatus = "loading" | "found" | "missing" | "failed";

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

export class ResearchSession {
  readonly stores: ResearchStores;
  // Only the searches pages read by ID; lists page through `listedSearches` themselves (#420).
  private watched = new Map<string, Watch<SavedSearch | null>>();
  // Only the ratings of the papers pages show, read by paper ID, and only the shortcuts the
  // queries in use name, read by name (#420).
  private rated: ReadsById<Rating> = { reads: new Map(), by: new Map() };
  private named: ReadsById<Shortcut> = { reads: new Map(), by: new Map() };
  private pending: Array<{ requestId: string; command: ResearchCommand }> = [];
  private listeners = new Set<() => void>();
  private stops: Array<() => void> = [];
  private epoch = 0;
  private pumping = false;
  private imported = false;
  private enabled = false;
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
      addKeyword: (shorthand, expansion) => this.dispatch({ kind: "shortcut", shorthand, value: { expansion, createdAt: Date.now() } }),
      updateKeyword: (shorthand, expansion, createdAt) => this.dispatch({ kind: "shortcut", shorthand, value: { expansion, createdAt } }),
      removeKeyword: shorthand => this.dispatch({ kind: "shortcut", shorthand, value: null }),
      // On the server, a batch at a time: the browser holds only the shortcuts in use.
      clearKeywords: () => { void this.client.mutation(api.research.records.clearShortcuts, { accountId: this.accountId }).catch(this.fail); },
      expandQuery: query => expandShortcuts(query, shortcutExpansions(shortcuts.getState().keywords)),
      ensureShortcuts: names => new Promise<void>(resolve => {
        const unique = [...new Set(names)];
        const settle = () => { if (this.idsRead(this.named, unique) === unique.length) resolve(); };
        setTimeout(this.watchShortcuts(unique, settle), ENSURE_MS);
        settle();
      }),
      importKeywords: async rows => {
        const named = rows.flatMap(row => {
          const shorthand = String(row.name ?? row.shorthand ?? "");
          return shorthand && row.expansion ? [{ shorthand, expansion: String(row.expansion), createdAt: typeof row.createdAt === "number" ? row.createdAt : Date.now() }] : [];
        });
        // A name the person already uses keeps its expansion.
        await shortcuts.getState().ensureShortcuts(named.map(row => row.shorthand));
        const fresh = named.filter(({ shorthand }, index) => !shortcuts.getState().keywords[shorthand] && named.findIndex(row => row.shorthand === shorthand) === index);
        for (const { shorthand, ...value } of fresh) this.dispatch({ kind: "shortcut", shorthand, value });
        return fresh.length;
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
    this.snapshot = { ...this.snapshot, ready: this.imported, pending: this.pending.length };
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
  private watches(): Array<Watch<unknown>> { return [...this.watched.values(), ...this.rated.reads.values(), ...this.named.reads.values()]; }
  /** Whether a read is still on its way: a search, ratings or shortcuts a page just asked for. */
  private reading() { return this.watches().some(({ value, failed }) => value === undefined && !failed); }
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
    void this.import(epoch);
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
   * store has them; returns the unsubscribe.
   */
  watchRatings = (paperIds: string[], reader: () => void) =>
    this.holdIds(this.rated, paperIds, RATED_PAPERS_MAX, chunk => this.client.watchQuery(api.research.records.ratingsOf, { accountId: this.accountId, paperIds: chunk }), reader);
  /** How many of these papers, from the first, have their ratings read, or a read that failed. */
  ratingsRead = (paperIds: string[]) => this.idsRead(this.rated, paperIds);
  /**
   * Reads the person's shortcuts with these names while `reader` wants them, so the shortcut
   * store expands them; returns the unsubscribe.
   */
  watchShortcuts = (names: string[], reader: () => void) =>
    this.holdIds(this.named, names, SHORTCUT_NAMES_MAX, chunk => this.client.watchQuery(api.research.records.shortcutsOf, { accountId: this.accountId, names: chunk }), reader);
  /** Whether every one of these names has been looked up. */
  shortcutsRead = (names: string[]) => this.idsRead(this.named, names) === names.length;
  /**
   * Holds the reads of these IDs for `reader`. An ID another read already has stays with that
   * read, and the rest are read up to `max` at a time, so a list that grows reads only what it
   * gained.
   */
  private holdIds<T>({ reads, by }: ReadsById<T>, given: string[], max: number, open: (ids: string[]) => Subscription<Page<T>>, reader: () => void) {
    const ids = [...new Set(given)];
    const fresh = ids.filter(id => !by.has(id));
    const stops = [...new Set(ids.flatMap(id => by.get(id) ?? []))].map(key => this.hold(reads, key, reads.get(key)!.open, reader));
    for (let start = 0; start < fresh.length; start += max) {
      const chunk = fresh.slice(start, start + max);
      const key = chunk.join("\n");
      for (const id of chunk) by.set(id, key);
      stops.push(this.hold(reads, key, () => open(chunk), reader, undefined, () => { for (const id of chunk) by.delete(id); }));
    }
    return () => { for (const stop of stops) stop(); };
  }
  /** How many of these IDs, from the first, are read, or have a read that failed. */
  private idsRead<T>({ reads, by }: ReadsById<T>, ids: string[]) {
    const unread = ids.findIndex(id => {
      const entry = reads.get(by.get(id) ?? "");
      return !entry || (entry.value === undefined && !entry.failed);
    });
    return unread === -1 ? ids.length : unread;
  }
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
          // Mutation completion includes live-query updates, but a page that just opened a
          // search, ratings or shortcuts may still be reading them. Keep optimism until
          // they arrive.
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
    const keywords = Object.fromEntries([...this.named.reads.values()].flatMap(({ value }) => value?.page ?? []).map(({ shorthand, ...value }) => [shorthand, value]));
    const ratings = Object.fromEntries([...this.rated.reads.values()].flatMap(({ value }) => value?.page ?? []).map(row => [row.paperId, row.rating]));
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
