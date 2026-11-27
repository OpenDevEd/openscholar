// What a screening's activity says: each change the server logged by its code (convex/screening/log.ts),
// in a sentence, with what it did under it and where it opens. One place, so the list and a file say it alike.

import type { EffectsSay } from "./effects";
import { overviewHref, papersHref, screenHref, settingsHref } from "./links";

export type Line = { code: string; count?: number; detail?: string };
export type Logged = { happened: string; code?: string; count?: number; detail?: string; more?: Line[] };

const line = (row: Logged, code: string) => row.more?.find((one) => one.code === code);

/** The parts of a screening's settings, as a change to them is named (`activity.setting`). */
const SETTING = { name: "name", question: "question", papers: "papers", "new-papers": "newPapers", criteria: "criteria", reviewers: "reviewers", decided: "decided", "goes-to": "goesTo" } as const;
const isSetting = (part: string): part is keyof typeof SETTING => Object.hasOwn(SETTING, part);

/** What happened, in a sentence, and under it what that did. */
export function changeSays(say: EffectsSay, row: Logged): { what: string; effect?: string } {
  const { words, t } = say;
  const { count = 0, detail = "" } = row;
  const effects = (says: Record<string, (one: Line) => string>) => (row.more ?? []).flatMap((one) => (says[one.code] ? [says[one.code]!(one)] : [])).join(". ") || undefined;
  const EFFECT = effectSays(say);
  switch (row.code) {
    case "started": {
      const [sources, people, models] = [line(row, "sources")?.count ?? 0, line(row, "people")?.count ?? 0, line(row, "models")?.count ?? 0];
      return { what: t("activity.started"), effect: t("activity.startedWith", { sources, who: words.listed([people ? words.count("people", people) : "", models ? words.count("models", models) : ""].filter(Boolean)) || words.t("startedNobody") }) };
    }
    case "renamed": return { what: t("activity.renamed", { name: words.quoted(detail) }) };
    case "finished": return { what: t("activity.finished"), effect: effects({ unsettled: (one) => t("activity.unsettled", { count: one.count ?? 0 }), checksStopped: () => t("activity.checksStopped") }) };
    case "reopened": return { what: t("activity.reopened") };
    case "paused": return { what: t("activity.paused") };
    case "resumed": return { what: t("activity.resumed") };
    case "moved": return { what: detail ? t("activity.movedTo", { to: detail }) : t("activity.movedAway") };
    case "reviewerAdded": return { what: t("activity.reviewerAdded", { name: detail }), effect: effects(EFFECT) };
    case "reviewerJoined": return { what: t("activity.reviewerJoined"), effect: effects(EFFECT) };
    case "reviewerRemoved": return { what: t("activity.reviewerRemoved", { name: detail }), effect: effects(EFFECT) };
    case "madeViewer": return { what: t("activity.madeViewer", { name: detail }), effect: effects(EFFECT) };
    case "reminded": return { what: t("activity.reminded", { name: detail }) };
    case "retried": return { what: t("activity.retried", { name: detail, count }) };
    case "papersMoved": { const to = line(row, "to")?.detail; const taker = { known: String(to !== undefined), to: to ?? "", count }; return { what: t("activity.papersMoved", { ...taker, from: detail }), effect: t("activity.papersMovedVotes", taker) }; }
    case "asked": return { what: t("activity.asked", { name: detail, paper: words.quoted(line(row, "paper")?.detail ?? t("activity.aPaper")) }) };
    case "checked":
    case "scheduledCheck": {
      const added = line(row, "joined")?.count ?? 0;
      const found = { count, added, allNew: String(added === count) };
      return { what: count ? (row.code === "checked" ? t("activity.checkedFound", found) : t("activity.scheduledFound", found)) : row.code === "checked" ? t("activity.checkedNone") : t("activity.scheduledNone"), effect: effects({ known: (one) => t("activity.known", { count: one.count ?? 0 }), leftOut: (one) => t("activity.leftOut", { count: one.count ?? 0 }), unread: (one) => t("activity.unread", { count: one.count ?? 0 }), joined: (one) => t("activity.joined", { count: one.count ?? 0 }), reopened: () => t("activity.reopenedByCheck") }) };
    }
    case "settings": {
      const parts = (row.more ?? []).flatMap((one) => (one.code === "part" && one.detail && isSetting(one.detail) ? [t(`activity.setting.${SETTING[one.detail]}`)] : []));
      return { what: parts.length ? t("activity.changed", { parts: words.listed(parts) }) : t("activity.changedSettings"), effect: effects(EFFECT) };
    }
  }
  // A change from before changes carried a code, or one another page made: said by its kind.
  const KIND: Record<string, string> = { created: t("activity.started"), renamed: t("activity.renamed", { name: words.quoted(detail) }), edited: detail || t("activity.changedIt"), added: detail ? t("activity.added", { what: detail }) : t("activity.addedPapers"), removed: detail ? t("activity.removed", { what: detail }) : t("activity.removedPapers"), screened: t("activity.screened", { count }), paused: t("activity.paused"), resumed: t("activity.resumed"), retried: t("activity.readAgain"), stopped: t("activity.stopped"), moved: detail ? t("activity.movedFrom", { from: detail }) : t("activity.movedAway"), shared: detail ? t("activity.shared", { who: detail }) : t("activity.sharedSomeone") };
  return { what: KIND[row.happened] ?? (detail || t("activity.changedIt")) };
}

/** What a change did, a line each, as the server counted it when the change was made. */
const effectSays = ({ t }: EffectsSay): Record<string, (one: Line) => string> => ({
  votesDiscarded: () => t("activity.votesDiscarded"),
  votesKept: (one) => t("activity.votesKept", { count: one.count ?? 0 }),
  dealt: (one) => t("activity.dealt", { count: one.count ?? 0 }),
  reads: (one) => t("activity.reads", { count: one.count ?? 0 }),
  moved: (one) => t("activity.papersMovedBy", { count: one.count ?? 0, detail: one.detail ?? "" }).trim(),
  joined: (one) => t("activity.joined", { count: one.count ?? 0 }),
  left: (one) => t("activity.left", { count: one.count ?? 0 }),
  rechecked: (one) => t("activity.rechecked", { count: one.count ?? 0 }),
});

/** Where a change opens: the papers a check brought, the setting it changed, the reviewers, or the paper it is about. */
export function changeOpens(id: string, row: Logged, canChange: boolean): string | undefined {
  switch (row.code) {
    case "started": return papersHref(id);
    case "checked":
    case "scheduledCheck": { const check = line(row, "check")?.detail; return check && line(row, "joined") ? papersHref(id, { added: check }) : undefined; }
    case "reviewerAdded":
    case "reviewerJoined":
    case "reviewerRemoved":
    case "madeViewer":
    case "reminded":
    case "retried":
    case "papersMoved":
    case "paused":
    case "resumed": return overviewHref(id, "reviewers");
    case "asked": { const paper = line(row, "paperId")?.detail; return paper ? screenHref(id, { queue: "conflicts", paper }) : undefined; }
    // Settings are opened only by whoever may change them: anyone else would land on a page that says they can't.
    case "settings": { if (!canChange) return undefined; const part = (row.more ?? []).find((one) => one.code === "part")?.detail; return settingsHref(id, part && isSetting(part) && part !== "name" && part !== "question" ? (part as "papers") : undefined); }
    case "renamed": return canChange ? settingsHref(id) : undefined;
  }
  return undefined;
}
