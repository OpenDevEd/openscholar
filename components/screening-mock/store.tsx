"use client";

// The mock's state, shared by every page under /screening/mock: its screenings, who the mock is
// seen as, and the workspace's credits. Every change a page makes goes through here, so the list,
// the form and the open screening always agree. It lives in the page: a reload starts it again.

import { createContext, use, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toMapModel, type MapModel } from "@/components/settings/model-map";
import { stripProviderPrefix } from "@/lib/ai/model-display";
import { CALL_TOKENS, estimateCredits } from "@/lib/pricing/estimate";
import { NOW, PEOPLE, SEED_MODELS, accessOf, activeReviewers, dealtTo, hasFullText, modelsOf, paperTotal, personReviewer, standing, startingScreenings, type Change, type Decision, type Paper, type Person, type Reviewer, type Screening, type Stage, type Standing, type Vote } from "./data";

type State = {
  screenings: Screening[];
  /** Who the mock is seen as. */
  viewer: string;
  /** The workspace's credits. */
  wallet: number;
  /** A workspace that has never screened anything, to see the first-time pages. */
  firstTime: boolean;
};

type Store = State & {
  me: Person;
  update: (id: string, change: (screening: Screening) => Screening, log?: Omit<Change, "at" | "by">) => void;
  add: (screening: Screening) => void;
  remove: (id: string) => void;
  set: (patch: Partial<State>) => void;
  tick: (id: string) => void;
};

const Context = createContext<Store | null>(null);

/** What a model costs for one paper at a stage, in credits: its price for the tokens that call takes at most, as the real estimate works it out. */
export function paperCredits(model: MapModel, stage: Stage) {
  return estimateCredits({ input: model.inputPricePerMillion, output: model.outputPricePerMillion }, stage === "fullText" ? CALL_TOKENS.pdfDecision : CALL_TOKENS.paper);
}
/** Credits as people read them: whole numbers once there are any, and never "0" for something that costs. */
export const credits = (n: number) => (n === 0 ? "0" : n < 10 ? n.toLocaleString("en-GB", { maximumFractionDigits: 1, minimumFractionDigits: n < 1 ? 1 : 0 }) : Math.ceil(n).toLocaleString("en-GB"));

/** Where the tab keeps the mock's state. The name changes with its shape. */
export const KEPT = "screening-mock:3";

/** The mock's clock for what happens in it: later than everything it started with. */
const now = () => Math.max(Date.now(), NOW + 1);

export function ScreeningMockProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(() => ({ screenings: startingScreenings(), viewer: PEOPLE[0]!.id, wallet: 18_420, firstTime: false }));
  // The tab's storage is the outside system: what was done in the mock is read back after a reload, and written as it changes.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    try {
      const kept = window.sessionStorage.getItem(KEPT);
      if (kept) setState(JSON.parse(kept) as State);
    } catch {
      // Storage that can't be read leaves the mock as it starts.
    }
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored) return;
    try {
      window.sessionStorage.setItem(KEPT, JSON.stringify(state));
    } catch {
      // Nothing is lost that a reload wouldn't lose anyway.
    }
  }, [state, restored]);
  // The real catalogue, so the made-up screenings run models a person can find in the picker.
  const catalog = useQuery(api.models.queries.listCatalogOptions, {});
  const screenings = useMemo(() => {
    if (!catalog?.length) return state.screenings;
    const named = (name: string) => catalog.find((row) => stripProviderPrefix(row.name) === name);
    const cheapest = (vendor: string) => catalog.filter((row) => row.modelId.startsWith(vendor) && !/free/i.test(row.name) && row.inputPricePerMillion > 0).sort((a, b) => a.inputPricePerMillion - b.inputPricePerMillion)[0];
    const real = [named(SEED_MODELS[0]!.name), named(SEED_MODELS[1]!.name) ?? cheapest("anthropic/"), named(SEED_MODELS[2]!.name) ?? cheapest("google/")];
    // Nothing to put in place while the catalogue still has them as they were written down.
    if (real.every((row, i) => row?.modelId === SEED_MODELS[i]!.id && row.inputPricePerMillion === SEED_MODELS[i]!.inputPricePerMillion && row.outputPricePerMillion === SEED_MODELS[i]!.outputPricePerMillion)) return state.screenings;
    const swap = (reviewer: Reviewer): Reviewer => {
      const row = real[SEED_MODELS.findIndex((seed) => seed.id === reviewer.model?.id)];
      return row ? { ...reviewer, name: stripProviderPrefix(row.name), model: { ...toMapModel(row), name: stripProviderPrefix(row.name) } } : reviewer;
    };
    return state.screenings.map((screening) => ({ ...screening, reviewers: screening.reviewers.map(swap) }));
  }, [state.screenings, catalog]);

  // The actions only ever work from the state as it stands, so they are made once and never change.
  const actions = useMemo(
    () => ({
      update: (id: string, fn: (screening: Screening) => Screening, log?: Omit<Change, "at" | "by">) =>
        setState((s) => ({
          ...s,
          screenings: s.screenings.map((one) => {
            if (one.id !== id) return one;
            const next = fn(one);
            return log ? { ...next, changes: [...next.changes, { ...log, at: now(), by: s.viewer }] } : next;
          }),
        })),
      add: (screening: Screening) => setState((s) => ({ ...s, firstTime: false, screenings: [screening, ...s.screenings] })),
      remove: (id: string) => setState((s) => ({ ...s, screenings: s.screenings.filter((one) => one.id !== id) })),
      set: (patch: Partial<State>) => setState((s) => ({ ...s, ...patch })),
      // One second of the models' reading: each running model gets through a few more papers, while the credits last.
      tick: (id: string) =>
        setState((s) => {
          const open = s.screenings.find((one) => one.id === id);
          if (!open || open.finishedAt) return s;
          // Its papers arrive first, a few hundred at a time.
          if (open.gathered !== undefined) {
            const total = paperTotal(open.sources);
            const gathered = open.gathered + Math.max(12, Math.ceil(total / 7));
            return { ...s, screenings: s.screenings.map((one) => (one.id === id ? { ...one, gathered: gathered >= total ? undefined : gathered } : one)) };
          }
          if (open.paused) return s;
          // The workspace's models read so many papers at once, so a screening started behind another waits its turn.
          const ahead = open.after ? s.screenings.find((one) => one.id === open.after) : undefined;
          const waits = ahead && isReading(ahead);
          if (open.after && !waits) return { ...s, screenings: s.screenings.map((one) => (one.id === id ? { ...one, after: undefined } : one)) };
          const screening = waits ? ahead : open;
          let wallet = s.wallet;
          const reached = { abstract: { ...screening.reached.abstract }, fullText: { ...screening.reached.fullText } };
          let moved = false;
          for (const stage of ["abstract", "fullText"] as const) {
            const total = standing({ ...screening, reached }, stage).papers.length;
            const step = Math.max(1, Math.ceil(total / 40));
            for (const reviewer of modelsOf(screening)) {
              const at = Math.min(reached[stage][reviewer.id] ?? 0, total);
              const each = paperCredits(reviewer.model!, stage);
              const more = Math.min(step, total - at, each > 0 ? Math.floor(wallet / each) : step);
              if (more <= 0) continue;
              reached[stage][reviewer.id] = at + more;
              wallet -= more * each;
              moved = true;
            }
          }
          return moved ? { ...s, wallet, screenings: s.screenings.map((one) => (one.id === screening.id ? { ...one, reached } : one)) } : s;
        }),
    }),
    [],
  );
  const store = useMemo<Store>(
    () => ({ ...state, screenings: state.firstTime ? [] : screenings, me: PEOPLE.find((person) => person.id === state.viewer) ?? PEOPLE[0]!, ...actions }),
    [state, screenings, actions],
  );

  return <Context value={store}>{children}</Context>;
}

/** Whether a screening's models still have papers to read on their title and abstract, and are free to. */
export const isReading = (screening: Screening) => !screening.finishedAt && !screening.paused && modelsOf(screening).some((model) => (screening.reached.abstract[model.id] ?? 0) < paperTotal(screening.sources));

export function useMock() {
  const store = use(Context);
  if (!store) throw new Error("The screening mock's pages sit under its provider");
  return store;
}

export type Open = NonNullable<ReturnType<typeof useOpenScreening>>;

/**
 * One screening as the person looking at it sees it, at a stage: where each paper stands, what is
 * theirs to do, what they may see, and what they can change.
 */
export function useOpenScreening(id: string, stage: Stage) {
  const store = useMock();
  const found = store.screenings.find((one) => one.id === id);
  // Someone from outside its workspace has it only once it is shared with them.
  const access = found ? accessOf(found, store.viewer) : null;
  const screening = access ? found : undefined;
  const state = useMemo<Standing | null>(() => (screening ? standing(screening, stage) : null), [screening, stage]);
  const first = useMemo<Standing | null>(() => (screening ? (stage === "abstract" ? state : standing(screening, "abstract")) : null), [screening, stage, state]);
  const second = useMemo<Standing | null>(() => (screening ? (stage === "fullText" ? state : standing(screening, "fullText")) : null), [screening, stage, state]);
  if (!screening || !access || !state || !first || !second) return null;
  const me = store.viewer;
  const reviewer = activeReviewers(screening).find((one) => one.id === me);
  const index = new Map(state.papers.map((paper, i) => [paper.id, i]));
  const mine = (paper: Paper) => dealtTo(screening, stage, paper, index.get(paper.id)!).some((one) => one.id === me);
  const myVote = (paper: Paper) => state.votes[paper.id]!.find((one) => one.reviewer.id === me)?.vote;
  const yours = reviewer ? state.papers.filter(mine) : [];
  const toDo = yours.filter((paper) => !myVote(paper));
  const conflicts = state.papers.filter((paper) => state.settled[paper.id]!.result === "conflict");
  const models = modelsOf(screening);
  // A model still has papers to read at this stage, and the credits to read them with or not.
  const reading = models.filter((model) => (screening.reached[stage][model.id] ?? 0) < state.papers.length);
  const outOfCredits = !screening.finishedAt && !screening.paused && reading.length > 0 && reading.every((model) => paperCredits(model.model!, stage) > store.wallet);
  const spent = (model: Reviewer) => STAGE_LIST.reduce((sum, one) => sum + Math.min(screening.reached[one][model.id] ?? 0, (one === "abstract" ? first : second).papers.length) * paperCredits(model.model!, one), 0);
  return {
    screening,
    stage,
    ...state,
    first,
    second,
    me,
    /** Whether the person looking votes here, may settle a split, and may change the screening. */
    isReviewer: Boolean(reviewer),
    canResolve: screening.rule.resolver === me || screening.createdBy === me,
    /** Its workspace's members change it. Someone it is shared with from outside votes or looks. */
    canChange: access.member,
    /** Its papers are still being fetched from its sources. */
    gathering: screening.gathered !== undefined ? { done: screening.gathered, of: paperTotal(screening.sources) } : null,
    /** The screening whose models read before this one's. */
    waitingFor: (() => {
      const ahead = screening.after ? store.screenings.find((one) => one.id === screening.after) : undefined;
      return ahead && isReading(ahead) ? { screening: ahead, done: Math.min(...modelsOf(ahead).map((model) => ahead.reached.abstract[model.id] ?? 0)), of: paperTotal(ahead.sources) } : null;
    })(),
    /** The papers a model got to and couldn't read. */
    unread: (model: Reviewer) => state.papers.filter((paper) => state.votes[paper.id]!.some((one) => one.reviewer.id === model.id && one.failed)).length,
    retry: (model: Reviewer, papers: number) => store.update(id, (s) => ({ ...s, retried: [...(s.retried ?? []), model.id] }), { what: `Sent ${model.name} back to ${papers} ${papers === 1 ? "paper" : "papers"} it couldn't read` }),
    /** A member who isn't one of its reviewers takes a share of the papers nobody has got to. */
    join: () => store.update(id, (s) => ({ ...s, reviewers: [...s.reviewers.filter((one) => one.id !== me), personReviewer(store.me, Date.now())], viewers: s.viewers?.filter((one) => one.id !== me), reached: { abstract: { ...s.reached.abstract, [me]: 0 }, fullText: { ...s.reached.fullText, [me]: 0 } } }), { what: "Joined as a reviewer" }),
    yours,
    toDo,
    conflicts,
    reading,
    outOfCredits,
    spent,
    myVote,
    /** Other votes show on a paper that isn't yours to vote on, on one you've voted on, and always where the rule says so. */
    canSee: (paper: Paper) => screening.rule.blind === "always" || !mine(paper) || Boolean(myVote(paper)),
    hasFullText: (paper: Paper) => hasFullText(screening, paper),
    /** How many of the papers still waiting each reviewer has yet to vote on. */
    waitingOn: activeReviewers(screening).map((one) => ({ reviewer: one, papers: state.papers.filter((paper) => state.settled[paper.id]!.result === "waiting" && state.votes[paper.id]!.some((entry) => entry.reviewer.id === one.id && !entry.vote && !entry.failed)).length })).filter((one) => one.papers > 0),
    vote: (paper: Paper, vote: Vote | null) =>
      store.update(id, (s) => ({ ...s, cast: { ...s.cast, [stage]: { ...s.cast[stage], [paper.id]: { ...s.cast[stage][paper.id], [me]: vote } } } })),
    resolve: (paper: Paper, decision: Decision | null, note?: string, reason?: string) =>
      store.update(id, (s) => ({ ...s, resolved: { ...s.resolved, [stage]: { ...s.resolved[stage], [paper.id]: decision ? { decision, by: me, ...(note ? { note } : {}), ...(reason ? { reason } : {}) } : null } } })),
    setFullText: (paper: Paper, value: "added" | "missing") => store.update(id, (s) => ({ ...s, fullTexts: { ...s.fullTexts, [paper.id]: value } })),
    update: (fn: (screening: Screening) => Screening, log?: Omit<Change, "at" | "by">) => store.update(id, fn, log),
  };
}
const STAGE_LIST: Stage[] = ["abstract", "fullText"];

/** Keeps the open screening's models reading while its page is up. The interval is the outside system. */
export function useModelsReading(id: string) {
  const { tick } = useMock();
  useEffect(() => {
    const timer = setInterval(() => tick(id), 1000);
    return () => clearInterval(timer);
  }, [id, tick]);
}
