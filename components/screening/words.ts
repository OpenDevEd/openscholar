"use client";

// The words every Screening page shares, in the reader's language: the names of results and decisions, a count
// with its noun, a list of names, numbers and dates, and the lines that are said the same wherever they stand
// (how a paper is settled, why a record was left out, a reason for excluding). A page takes them from
// `useWords()`. A function that is not a component is handed them as `Words`.

import { useFormatter, useNow, useTranslations } from "next-intl";
import { NAMED_REASONS, NO_REASON, OTHER_REASONS, SOMEONE, type Decision, type Result } from "@/lib/screening/rules";
import { criterionLabel, isNamed, nameOn as nameOnScreening } from "./data";

/** A criterion as far as its name goes. */
type Named = { key: string; text: string; short: string; must: boolean };
/** A screening as far as naming the people on it goes. */
type Peopled = { reviewers: Array<{ id: string; name: string }>; people: Record<string, { name: string } | undefined> };
const DAY = 86_400_000;

/** The shared messages' translator and the formatter of numbers, dates and lists, for whichever language. `effort` names a model's reasoning effort as the model picker does, where the language isn't English. */
type Said = { t: ReturnType<typeof useTranslations<"screening.words">>; format: ReturnType<typeof useFormatter>; effort?: (level: string) => string; /** The clock "how long ago" is told by: a page's ticks each minute, so "just now" moves on. */ clock?: number };

/** The shared words of the reader's own language. */
export function useWords() {
  const efforts = useTranslations("settingsAi.efforts");
  // A clock that moves on each minute: every "how long ago" on the page is told by it, and the page draws again as it moves.
  const clock = useNow({ updateInterval: 60_000 }).getTime();
  return wordsOf({ t: useTranslations("screening.words"), format: useFormatter(), effort: (level) => (efforts.has(level as "high") ? efforts(level as "high") : level), clock });
}

/**
 * The shared words from a translator and a formatter: what `useWords` hands a page, and what a file is written
 * with, whose words are English whoever downloads it (./export.ts).
 */
/** An amount of credits as it is shown: whole numbers from 10, a tenth below, and never 0 for something that costs. */
const creditsOf = (n: number) => (n <= 0 ? 0 : n < 10 ? Math.max(0.1, Math.round(n * 10) / 10) : Math.ceil(n));
export function wordsOf({ t, format, effort = (level) => level, clock }: Said) {

  /** A number as people read it: "1,204". */
  const num = (n: number) => format.number(n);
  /** A date as "17 Nov", with its year only when that isn't this year. */
  const day = (at: number) => format.dateTime(new Date(at), { day: "numeric", month: "short", ...(new Date(at).getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) });
  /** Names as a phrase: "A", "A and B", "A, B and C". */
  const listed = (names: string[]) => format.list(names, { type: "conjunction" });
  /** What someone wrote, quoted: a note with a vote, a paper's title in a line of text. One form everywhere. */
  const quoted = (text: string) => t("quoted", { text });
  const otherReason = (key: string) => (NAMED_REASONS as readonly string[]).includes(key) ? t(`otherReason.${key as (typeof NAMED_REASONS)[number]}`) : undefined;
  /** A criterion by its key, as a line names it (./data.ts `criterionLabel`). */
  const labelOf = (key: string, criteria: Named[]) => { const criterion = criteria.find((one) => one.key === key); return criterion && criterionLabel(criterion); };
  /** A reason in words: the criterion as a line names it, or one of the others. */
  const reason = (key: string, criteria: Named[]) => labelOf(key, criteria) ?? otherReason(key) ?? key;
  /** Someone on a screening by name, or the words for someone whose account is gone. */
  const nameOn = (screening: Peopled, id: string) => nameOnScreening(screening, id, t("someone"));
  /** The name someone is called by in a line of text or a narrow column. */
  const firstName = (name: string) => name.split(" ")[0]!;

  return {
    /** The shared messages themselves, for a word that needs no working out: `words.t("settle.label.all")`. */
    t,
    num,
    day,
    listed,
    quoted,
    isNamed,
    criterionLabel,
    reason,
    nameOn,
    firstName,
    /** A count with its noun: "1 paper", "1,204 papers". */
    count: (noun: CountNoun, count: number) => t(`count.${noun}`, { count }),
    /** Credits as people read them: whole numbers from 10, a tenth below, and never "0" for something that costs. */
    credits: (n: number) => format.number(creditsOf(n), { minimumFractionDigits: n > 0 && n < 1 ? 1 : 0 }),
    /** The same amount as a number, for a message that says "credit" or "credits" after it. */
    creditsOf,
    decision: (decision: Decision) => t(`decision.${decision}`),
    result: (result: Result) => t(`result.${result}`),
    /** A small number as a word at the start of a sentence: "Three of the 5 reviewers". */
    numberWord: (n: number) => (n >= 1 && n <= 10 && Number.isInteger(n) ? t("numberWord", { n: String(n) }) : num(n)),
    /** A person as the one looking reads them at the start of a line: "You" for themselves, their name for anyone else. */
    youOr: (person: { id: string; name: string }, me: string | undefined) => (person.id === me ? t("you") : person.name),
    /** Someone on a screening as the person looking reads them inside a line: "you" for themselves, the name for anyone else, or a first name where there is little room. */
    whoIs: (screening: Peopled, id: string, me: string, short = false) => (id === me ? t("youInline") : short ? firstName(nameOn(screening, id)) : nameOn(screening, id)),
    /** Who settles a screening's conflicts, as the start of a sentence about it: "you settle" or "Kwame Mensah settles". */
    settlerSettles: (screening: Peopled & { rule: { resolver: string } }, me: string) => t("settler", { you: String(screening.rule.resolver === me), name: nameOn(screening, screening.rule.resolver) }),
    /** What someone who has no vote on a screening is called: a member of its workspace is not a reviewer, someone it is shared with from outside is a viewer. */
    looker: (member: boolean) => t("looker", { member: String(member) }),
    /** Where a person stands to a screening's workspace, as the line under their name. */
    standsTo: (person: { guest?: boolean } | undefined) => (person?.guest ? t("person.guest") : t("person.member")),
    /** One model on a screening at two efforts: each says its effort (lib/screening/rules.ts `twinsNamed`), in the words the model picker has for it. */
    modelAtEffort: (name: string, level: string) => t("modelAtEffort", { name, effort: effort(level).toLocaleLowerCase() }),
    /** A model's effort as the model picker names it, in a word. */
    effortOf: (level: string) => effort(level),
    /** What tells one model on a screening at two efforts from its twin, in a word: its effort. Null for any other reviewer. */
    twinEffort: (reviewer: { name: string; model?: { name: string; effort?: string } }) => (reviewer.model?.effort && reviewer.name !== reviewer.model.name ? effort(reviewer.model.effort) : null),
    /** A person by the name the server gives them: one whose account is gone is said in the reader's language. */
    person: (name: string) => (name === SOMEONE ? t("someone") : name),
    /** A reason for excluding in words, the same on a page, in a tooltip and in a file: the criterion that wasn't met, by the name someone gave it or by its question, or one of the other reasons. */
    failed: (key: string, criteria: Named[]) => {
      const criterion = criteria.find((one) => one.key === key);
      return criterion ? (isNamed(criterion) ? t("notMet", { name: criterion.short }) : t("notMetInFull", { name: criterionLabel(criterion) })) : reason(key, criteria);
    },
    /** A criterion nobody could answer, as the reason a paper stands at Maybe, in words. */
    unclear: (key: string, criteria: Named[]) => t("unclearOn", { name: labelOf(key, criteria) ?? key }),
    /** What Exclude asks, the same wherever it asks: no reason (on Enter), a duplicate, or another reason written down. Each has a key for the keyboard. */
    excludeGroups: (many = false) => [
      // A title and abstract needs no reason to be excluded (PRISMA 2020 asks for reasons only of full texts): no reason comes first, on Enter. A duplicate is counted on its own; another reason is written down.
      { name: t("excludeAsk.why", { many: String(many) }), list: [{ key: NO_REASON as string, hotkey: "Enter" }, ...OTHER_REASONS.map((key) => ({ key: key as string, hotkey: key[0]!.toUpperCase() }))] },
    ],
    /** The name a screening's own collection of included papers has, unless it is given another. */
    includedIn: (name: string) => t("includedIn", { name }),
    /** Where a screening's included papers are saved, by name, or null where they stay in it. The pages and the files both read this. */
    collectionName: (screening: { name: string; destination: { kind: string; name: string; community?: { collection: string } } }) => {
      const to = screening.destination;
      if (to.kind === "none") return null;
      if (to.kind === "new" || to.community?.collection === "new") return to.name || t("includedIn", { name: screening.name });
      // A collection there already is, in the workspace or in a community, has the name it has there.
      return to.name || null;
    },
    /** What a living screening is, in a chip: the word and what it means. */
    living: (every: "day" | "week" | "month") => t("living", { every }),
    /** What starting a screening says it began with: its papers and sources, and who screens it. A count of none is left out. */
    started: (papers: number, sources: number, people: number, models: number) =>
      t("started", { papers, sources, who: listed([people ? t("count.people", { count: people }) : "", models ? t("count.models", { count: models }) : ""].filter(Boolean)) || t("startedNobody") }),
    /** What stands where no paper has a result: on a Papers tab and in the Export dialog. "Yet" only while the screening is running. */
    empty: (result: Result | "all", finished: boolean) => (result === "all" || result === "conflict" || result === "waiting" ? t(`empty.${result}`) : t(`empty.${result}`, { finished: String(finished) })),
    /** A date as a page shows it: how long ago for the last week, the day before that. */
    ago: (at: number, now = clock ?? Date.now()) => {
      const minutes = Math.max(0, Math.round((now - at) / 60_000));
      if (minutes < 1) return t("ago.now");
      if (minutes < 60) return t("ago.minutes", { count: minutes });
      // Days are counted on the calendar: a vote cast late yesterday was cast yesterday, not "18 h ago".
      const midnight = (time: number) => new Date(time).setHours(0, 0, 0, 0);
      const days = Math.round((midnight(now) - midnight(at)) / DAY);
      if (days <= 0) return t("ago.hours", { count: Math.round(minutes / 60) });
      if (days === 1) return t("ago.yesterday");
      if (days < 7) return t("ago.days", { count: days });
      return day(at);
    },
  };
}
export type Words = ReturnType<typeof wordsOf>;
/** The nouns a count is said with (`screening.words.count`). */
export type CountNoun = "papers" | "newPapers" | "openPapers" | "sources" | "people" | "models" | "reviewers" | "votes" | "criteria" | "mustHaves" | "conflicts" | "questions" | "duplicates" | "pages" | "pdfs" | "dois" | "collections" | "subCollections" | "items" | "rows" | "readings" | "changes" | "credits";
