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
import { NOW, PEOPLE, SEED_MODELS, accessOf, activeReviewers, checked, dealtTo, growing, keep, madeUpReply, readBy, readNext, stillReading, waitingQuestions, withReviewer, modelsOf, paperTotal, personReviewer, standing, startingScreenings, withUpdates, type Change, type Decision, type Paper, type Person, type Reviewer, type Screening, type Standing, type Vote } from "./data";

type State = {
  screenings: Screening[];
  /** Who the mock is seen as. */
  viewer: string;
  /** The workspace's credits. */
  wallet: number;
  /** A workspace that started with nothing screened, to see the first-time pages. */
  firstTime: boolean;
  /** Changes to a screening's settings that aren't saved yet, and a new screening being filled in, by where they are made. */
  drafts: Record<string, Screening>;
  /** The queue's pane on Screen is folded away, to give the paper its width. Kept with the tab, so it holds from page to page. */
  folded?: boolean;
  /** The criteria whose guidance is open on Screen, each as its screening and its key. A reviewer who wants a rule in front of them opens it once, and it stays open from paper to paper. */
  guides?: string[];
  /** Each person's pace on Screen: the seconds between their votes, added up, and how many gaps that is. Kept with the tab, so the time left reads the same after a look at another page, and by person, so seeing the mock as someone else starts from their own. */
  paced?: Record<string, { sum: number; n: number }>;
};

type Store = State & {
  me: Person;
  /** What was done in the mock before a reload has been read back. Until then a page shows the mock as it starts: anything it holds on to (a queue, as it was when opened) waits for this. */
  ready: boolean;
  update: (id: string, change: (screening: Screening) => Screening, log?: Omit<Change, "at" | "by">) => void;
  add: (screening: Screening) => void;
  remove: (id: string) => void;
  set: (patch: Partial<State>) => void;
  tick: (id: string) => void;
  /** Changes a draft, or drops it when `change` gives nothing back. */
  draft: (key: string, change: (now: Screening | undefined) => Screening | undefined) => void;
};

const Context = createContext<Store | null>(null);

/** What a model costs for one paper, in credits: its price for the tokens that call takes at most, as the real estimate works it out. */
export function paperCredits(model: MapModel) {
  return estimateCredits({ input: model.inputPricePerMillion, output: model.outputPricePerMillion }, CALL_TOKENS.paper);
}
/** Credits as people read them: whole numbers once there are any, and never "0" for something that costs. */
export const credits = (n: number) => (n === 0 ? "0" : n < 10 ? n.toLocaleString("en-GB", { maximumFractionDigits: 1, minimumFractionDigits: n < 1 ? 1 : 0 }) : Math.ceil(n).toLocaleString("en-GB"));

/** Where the tab keeps the mock's state. The name changes with its shape. */
export const KEPT = "screening-mock:9";

/** What a screening is set up as: a change here is a change to its settings, which a vote is not. */
const settingsOf = (screening: Screening) => JSON.stringify([screening.name, screening.question, screening.sources, screening.criteria, screening.reviewers, screening.rule, screening.scoring, screening.destination, screening.living?.every]);

/** What decides where a paper stands, apart from the votes: its papers, its criteria, who is on it and its rule. A change to any of these holds the settled papers' results. */
const rulesOf = (screening: Screening) => JSON.stringify([screening.sources, screening.criteria, screening.reviewers.map((one) => [one.id, one.left, one.discarded]), screening.rule.each, screening.rule.settle]);

/** What each model has cost by the time the mock opens: what it has read, at its price. */
const withSpent = (screening: Screening): Screening => {
  const models = modelsOf(screening);
  if (!models.length) return screening;
  const total = standing(screening).papers.length;
  return { ...screening, spent: Object.fromEntries(models.map((model) => [model.id, Math.min(screening.reached[model.id] ?? 0, total) * paperCredits(model.model!)])) };
};
/** The screenings the mock opens with. */
export const seeded = () => startingScreenings().map(withSpent);

/** The mock's clock for what happens in it: later than everything it started with. */
const now = () => Math.max(Date.now(), NOW + 1);

export function ScreeningMockProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(() => ({ screenings: seeded(), viewer: PEOPLE[0]!.id, wallet: 18_420, firstTime: false, drafts: {} }));
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
          // Settings changed here, from the open screening or by a save: a draft started from the old ones is dropped.
          drafts: s.drafts[id] && s.screenings.some((one) => one.id === id && settingsOf(fn(one)) !== settingsOf(one)) ? Object.fromEntries(Object.entries(s.drafts).filter(([key]) => key !== id)) : s.drafts,
          screenings: s.screenings.map((one) => {
            if (one.id !== id) return one;
            const made = fn(one);
            // A change to what decides a paper applies from now on: the papers already settled keep their result, unless the change asks for them to be checked again.
            const next = made.recheck || rulesOf(made) !== rulesOf(one) ? keep(one, made, now()) : made;
            return log ? { ...next, changes: [...next.changes, { ...log, at: now(), by: s.viewer }] } : next;
          }),
        })),
      add: (screening: Screening) => setState((s) => ({ ...s, screenings: [screening, ...s.screenings] })),
      draft: (key: string, change: (now: Screening | undefined) => Screening | undefined) =>
        setState((s) => {
          const next = change(s.drafts[key]);
          const { [key]: _dropped, ...rest } = s.drafts;
          return { ...s, drafts: next ? { ...rest, [key]: next } : rest };
        }),
      remove: (id: string) => setState((s) => ({ ...s, screenings: s.screenings.filter((one) => one.id !== id) })),
      set: (patch: Partial<State>) => setState((s) => ({ ...s, ...patch })),
      // One second of the models' reading: each running model gets through a few more papers, while the credits last.
      tick: (id: string) =>
        setState((s) => {
          const open = s.screenings.find((one) => one.id === id);
          if (!open) return s;
          // A question put to a made-up reviewer is answered a few seconds later: the mock has nobody else to write the answer.
          const made = (question: { by: string; to?: string; at: number }) => question.to !== s.viewer && question.by !== question.to && question.at < now() - 4000 && open.reviewers.some((one) => one.id === question.to && one.kind === "person" && !one.left && !one.email);
          const waiting = Object.entries(open.threads ?? {}).find(([, said]) => waitingQuestions(said).some(made));
          if (waiting) {
            const [paperId, said] = waiting;
            const asked = waitingQuestions(said).find(made)!.to!;
            const state = standing(open);
            const vote = state.votes[paperId]?.find((one) => one.reviewer.id === asked)?.vote;
            return { ...s, screenings: s.screenings.map((one) => (one.id === id ? { ...one, threads: { ...one.threads, [paperId]: [...said, { by: asked, at: now(), text: madeUpReply(vote, open.criteria) }] } } : one)) };
          }
          // A check of its sources, which a finished screening can be given too: each answers in turn, then what they found joins the queue.
          if (open.checking) {
            const done = open.checking.done + 1;
            const next = done >= open.checking.of ? checked(open, now(), open.checking.by) : { ...open, checking: { ...open.checking, done } };
            // Settings being changed keep up with what the check found, so saving them loses none of it.
            return { ...s, drafts: s.drafts[id] && !next.checking ? { ...s.drafts, [id]: withUpdates(s.drafts[id], next) } : s.drafts, screenings: s.screenings.map((one) => (one.id === id ? next : one)) };
          }
          if (open.finishedAt) return s;
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
          const reached = { ...screening.reached };
          const spent = { ...screening.spent };
          let moved = false;
          const step = Math.max(1, Math.ceil(standing(screening).papers.length / 40));
          for (const reviewer of modelsOf(screening)) {
            const each = paperCredits(reviewer.model!);
            // It gets through the next papers in its way, and pays for the ones it reads: a paper settled before it was added is passed over.
            const next = readNext(screening, reviewer, step, () => (each > 0 ? Math.floor(wallet / each) : Infinity));
            if (next.reached === (reached[reviewer.id] ?? 0)) continue;
            reached[reviewer.id] = next.reached;
            wallet -= next.read * each;
            spent[reviewer.id] = (spent[reviewer.id] ?? 0) + next.read * each;
            moved = true;
          }
          return moved ? { ...s, wallet, screenings: s.screenings.map((one) => (one.id === screening.id ? { ...one, reached, spent } : one)) } : s;
        }),
    }),
    [],
  );
  const store = useMemo<Store>(
    () => ({ ...state, screenings, me: PEOPLE.find((person) => person.id === state.viewer) ?? PEOPLE[0]!, ready: restored, ...actions }),
    [state, screenings, actions, restored],
  );

  return <Context value={store}>{children}</Context>;
}

/** Whether a screening's models still have papers to read, and are free to. */
export const isReading = (screening: Screening) => !screening.finishedAt && !screening.paused && modelsOf(screening).some((model) => stillReading(screening, model));

export function useMock() {
  const store = use(Context);
  if (!store) throw new Error("The screening mock's pages sit under its provider");
  return store;
}

export type Open = NonNullable<ReturnType<typeof useOpenScreening>>;
/** The held results without one paper's. A person lets a paper go by voting on it or settling it. A model reading on never does: a result someone chose to keep is not undone by a model getting to the paper. */
const letGo = (kept: Screening["kept"], paper: string) => (kept?.[paper] ? Object.fromEntries(Object.entries(kept).filter(([id]) => id !== paper)) : kept);

/**
 * One screening as the person looking at it sees it: where each paper stands, what is
 * theirs to do, what they may see, and what they can change.
 */
export function useOpenScreening(id: string) {
  const store = useMock();
  const found = store.screenings.find((one) => one.id === id);
  // Someone from outside its workspace has it only once it is shared with them.
  const access = found ? accessOf(found, store.viewer) : null;
  const screening = access ? found : undefined;
  const state = useMemo<Standing | null>(() => (screening ? standing(screening) : null), [screening]);
  if (!screening || !access || !state) return null;
  const me = store.viewer;
  const reviewer = activeReviewers(screening).find((one) => one.id === me);
  const mine = (paper: Paper) => dealtTo(screening, paper).some((one) => one.id === me);
  const myVote = (paper: Paper) => state.votes[paper.id]!.find((one) => one.reviewer.id === me)?.vote;
  const yours = reviewer ? state.papers.filter(mine) : [];
  // A paper that has its final decision waits for nobody: settled by the first vote, or by the person who settles conflicts.
  const toDo = yours.filter((paper) => !myVote(paper) && !state.settled[paper.id]!.final);
  const conflicts = state.papers.filter((paper) => state.settled[paper.id]!.result === "conflict");
  const models = modelsOf(screening);
  // A model still has papers to read, and the credits to read them with or not.
  const reading = models.filter((model) => stillReading(screening, model));
  const outOfCredits = !screening.finishedAt && !screening.paused && reading.length > 0 && reading.every((model) => paperCredits(model.model!) > store.wallet);
  const spent = (model: Reviewer) => screening.spent?.[model.id] ?? 0;
  const movable = (fromId: string, toId: string) =>
    state.papers.filter((paper) => {
      const cast = state.votes[paper.id]!;
      return !state.settled[paper.id]!.final && cast.some((one) => one.reviewer.id === fromId && !one.vote) && !cast.some((one) => one.reviewer.id === toId);
    });
  /** The most a model can come to: what it has cost, and the papers it has still to read. */
  const most = (model: Reviewer) => spent(model) + readNext(screening, model, Infinity, () => Infinity).read * paperCredits(model.model!);
  return {
    screening,
    ...state,
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
      return ahead && isReading(ahead) ? { screening: ahead, done: Math.min(...modelsOf(ahead).map((model) => readBy(ahead, model))), of: paperTotal(ahead.sources) } : null;
    })(),
    /** Looks in its sources again now, whoever asks: the papers they gained since the last look join the queue. */
    check: () => store.update(id, (s) => (s.checking || !growing(s).length ? s : { ...s, checking: { done: 0, of: growing(s).length, by: me } })),
    /** What the last check brought: how many papers, and how many of them wait for the person looking. */
    latest: (() => {
      const last = screening.updates?.findLast((update) => update.added > 0);
      if (!last) return null;
      const papers = state.papers.filter((paper) => paper.batch === last.at);
      return { ...last, papers: papers.length, mine: reviewer ? papers.filter((paper) => !state.settled[paper.id]!.final && state.votes[paper.id]!.some((one) => one.reviewer.id === me && !one.vote)).length : 0, open: papers.filter((paper) => !state.settled[paper.id]!.final).length };
    })(),
    /** The papers a model got to and couldn't read. */
    unread: (model: Reviewer) => state.papers.filter((paper) => state.votes[paper.id]!.some((one) => one.reviewer.id === model.id && one.failed)),
    /** Sends a model back to the papers it couldn't read. Reading them again is paid for like any reading. */
    retry: (model: Reviewer) => {
      const papers = state.papers.filter((paper) => state.votes[paper.id]!.some((one) => one.reviewer.id === model.id && one.failed)).length;
      const cost = papers * paperCredits(model.model!);
      store.update(id, (s) => ({ ...s, retried: [...(s.retried ?? []), model.id], spent: { ...s.spent, [model.id]: (s.spent?.[model.id] ?? 0) + cost } }), { what: `Sent ${model.name} back to ${papers} ${papers === 1 ? "paper" : "papers"} it couldn't read`, effect: `${credits(cost)} credits` });
      store.set({ wallet: Math.max(0, store.wallet - cost) });
    },
    /** A member who isn't one of its reviewers takes a share of the papers nobody has got to. */
    join: () => store.update(id, (s) => ({ ...s, ...withReviewer(s, personReviewer(store.me, Date.now())), viewers: s.viewers?.filter((one) => one.id !== me) }), { what: "Joined as a reviewer" }),
    yours,
    toDo,
    conflicts,
    reading,
    outOfCredits,
    spent,
    most,
    myVote,
    /** Other votes show on a paper that isn't yours to vote on, on one you've voted on, and always where the rule says so. */
    canSee: (paper: Paper) => screening.rule.blind === "always" || !mine(paper) || Boolean(myVote(paper)),
    /** How many of the papers still waiting each reviewer has yet to vote on. */
    waitingOn: activeReviewers(screening).map((one) => ({ reviewer: one, papers: state.papers.filter((paper) => state.settled[paper.id]!.result === "waiting" && state.votes[paper.id]!.some((entry) => entry.reviewer.id === one.id && !entry.vote && !entry.failed)).length })).filter((one) => one.papers > 0),
    // A vote on a paper whose result was held lets go of it: the paper stands where its votes put it under the settings as they are now.
    vote: (paper: Paper, vote: Vote | null) =>
      store.update(id, (s) => ({ ...s, kept: letGo(s.kept, paper.id), cast: { ...s.cast, [paper.id]: { ...s.cast[paper.id], [me]: vote } } })),
    resolve: (paper: Paper, decision: Decision | null, note?: string, reason?: string) =>
      store.update(id, (s) => ({ ...s, kept: letGo(s.kept, paper.id), resolved: { ...s.resolved, [paper.id]: decision ? { decision, by: me, ...(note ? { note } : {}), ...(reason ? { reason } : {}) } : null } })),
    update: (fn: (screening: Screening) => Screening, log?: Omit<Change, "at" | "by">) => store.update(id, fn, log),
    /** What was said about a paper, oldest first. */
    thread: (paper: Paper) => screening.threads?.[paper.id] ?? [],
    /** Adds a line to a paper's discussion. With `to`, it is a question that waits for that reviewer. */
    // A question put to one reviewer is written into the screening's activity too, where someone looks for what was asked lately.
    say: (paper: Paper, text: string, to?: string) => store.update(id, (s) => ({ ...s, threads: { ...s.threads, [paper.id]: [...(s.threads?.[paper.id] ?? []), { by: me, at: Math.max(Date.now(), NOW + 1), text, ...(to ? { to } : {}) }] } }), to ? { what: `Asked ${PEOPLE.find((one) => one.id === to)?.name ?? "a reviewer"} about “${paper.title}”` } : undefined),
    /** The papers whose discussion ends on a question for the person looking. */
    asked: state.papers.filter((paper) => waitingQuestions(screening.threads?.[paper.id]).some((question) => question.to === me)),
    /** The papers one person has yet to vote on that another doesn't have: what can be moved from the first to the second. */
    movable,
    /** Moves so many of one person's unvoted papers to another, the ones furthest down their queue first. */
    move: (from: Reviewer, to: Reviewer, papers: number) => {
      const picked = movable(from.id, to.id).slice(-papers);
      if (!picked.length) return;
      store.update(
        id,
        (s) => ({
          ...s,
          moved: {
            ...s.moved,
            ...Object.fromEntries(
              picked.map((paper) => {
                const now = s.moved?.[paper.id] ?? {};
                // A paper that came to them by an earlier move goes on from whoever had it first.
                const first = Object.entries(now).find(([, holder]) => holder === from.id)?.[0] ?? from.id;
                return [paper.id, { ...now, [first]: to.id }];
              }),
            ),
          },
        }),
        { what: `Moved ${picked.length} ${picked.length === 1 ? "paper" : "papers"} from ${from.name} to ${to.name}`, effect: `${to.name} votes on ${picked.length === 1 ? "it" : "them"} now` },
      );
    },
  };
}

/** Keeps the open screening's models reading while its page is up. The interval is the outside system. */
export function useModelsReading(id: string) {
  const { tick } = useMock();
  useEffect(() => {
    const timer = setInterval(() => tick(id), 1000);
    return () => clearInterval(timer);
  }, [id, tick]);
}
