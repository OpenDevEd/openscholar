// What a screening's activity says: each change the server logged by its code (convex/screening/log.ts),
// in a sentence, with what it did under it and where it opens. One place, so the list and a file say it alike.

import { inQuotes, listed, plural } from "./data";
import { overviewHref, papersHref, screenHref, settingsHref } from "./links";

export type Line = { code: string; count?: number; detail?: string };
export type Logged = { happened: string; code?: string; count?: number; detail?: string; more?: Line[] };

const line = (row: Logged, code: string) => row.more?.find((one) => one.code === code);

/** The parts of a screening's settings, as a change to them is named. */
const SETTING: Record<string, string> = { name: "its name", question: "the research question", papers: "its sources", "new-papers": "how it looks for new papers", criteria: "its criteria", reviewers: "its reviewers", decided: "how a paper is decided", "goes-to": "where included papers go" };

/** What happened, in a sentence, and under it what that did. */
export function changeSays(row: Logged): { what: string; effect?: string } {
  const { count = 0, detail = "" } = row;
  const effects = (says: Record<string, (one: Line) => string>) => (row.more ?? []).flatMap((one) => (says[one.code] ? [says[one.code]!(one)] : [])).join(". ") || undefined;
  switch (row.code) {
    case "started": {
      const [sources, people, models] = [line(row, "sources")?.count ?? 0, line(row, "people")?.count ?? 0, line(row, "models")?.count ?? 0];
      return { what: "Started the screening", effect: `${plural(sources, "source", "sources")}, for ${listed([people ? plural(people, "person", "people") : "", models ? plural(models, "model", "models") : ""].filter(Boolean)) || "reviewers still to be added"}` };
    }
    case "renamed": return { what: `Renamed it ${inQuotes(detail)}` };
    case "finished": return { what: "Marked the screening as finished", effect: effects({ unsettled: (one) => `${plural(one.count ?? 0, "paper was", "papers were")} not settled`, checksStopped: () => "It stopped checking for new papers" }) };
    case "reopened": return { what: "Reopened the screening" };
    case "paused": return { what: "Paused the models" };
    case "resumed": return { what: "Resumed the models" };
    case "moved": return { what: `Moved it to ${detail || "another workspace"}` };
    case "reviewerAdded": return { what: `Added ${detail} as a reviewer`, effect: effects(EFFECT) };
    case "reviewerJoined": return { what: "Joined as a reviewer", effect: effects(EFFECT) };
    case "reviewerRemoved": return { what: `Took ${detail} off the screening`, effect: effects(EFFECT) };
    case "madeViewer": return { what: `Made ${detail} a viewer`, effect: effects(EFFECT) };
    case "reminded": return { what: `Sent ${detail} a reminder` };
    case "retried": return { what: `Sent ${detail} back to ${count ? plural(count, "paper", "papers") : "the papers"} it couldn't read` };
    case "papersMoved": { const to = line(row, "to")?.detail ?? "someone else"; return { what: `Moved ${plural(count, "paper", "papers")} from ${detail} to ${to}`, effect: `${to} votes on ${count === 1 ? "it" : "them"} now` }; }
    case "asked": return { what: `Asked ${detail} about ${inQuotes(line(row, "paper")?.detail ?? "a paper")}` };
    case "checked":
    case "scheduledCheck": {
      const added = line(row, "joined")?.count ?? 0;
      const found = row.code === "checked" ? "Checked for new papers and found" : "The scheduled check found";
      return { what: count ? `${found} ${plural(count, "paper", "papers")}${added !== count ? `, ${added} of them new` : ""}` : row.code === "checked" ? "Checked for new papers and found none" : "The scheduled check found no new papers", effect: effects({ known: (one) => `${plural(one.count ?? 0, "was", "were")} already in the screening`, joined: (one) => `${plural(one.count ?? 0, "paper", "papers")} joined the screening`, reopened: () => "The screening is open again" }) };
    }
    case "settings": return { what: `Changed ${listed((row.more ?? []).flatMap((one) => (one.code === "part" && one.detail && SETTING[one.detail] ? [SETTING[one.detail]!] : []))) || "its settings"}`, effect: effects(EFFECT) };
  }
  // A change from before changes carried a code, or one another page made: said by its kind.
  const KIND: Record<string, string> = { created: "Started the screening", renamed: `Renamed it ${inQuotes(detail)}`, edited: detail || "Changed it", added: detail ? `Added ${detail}` : "Added papers", removed: detail ? `Took ${detail} off` : "Removed papers", screened: `Screened ${plural(count, "paper", "papers")}`, paused: "Paused the models", resumed: "Resumed the models", retried: "Read some papers again", stopped: "Stopped the screening", moved: detail ? `Moved it from ${detail}` : "Moved it to another workspace", shared: `Shared it with ${detail || "someone"}` };
  return { what: KIND[row.happened] ?? (detail || "Changed it") };
}

/** What a change did, a line each, as the server counted it when the change was made. */
const EFFECT: Record<string, (one: Line) => string> = {
  votesDiscarded: () => "Their votes stay on record and stop counting",
  votesKept: (one) => `${plural(one.count ?? 0, "vote keeps", "votes keep")} counting`,
  dealt: (one) => `${plural(one.count ?? 0, "open paper", "open papers")} went to them`,
  reads: (one) => `It reads ${plural(one.count ?? 0, "paper", "papers")}`,
  moved: (one) => `${plural(one.count ?? 0, "paper", "papers")} moved ${one.detail ?? ""}`.trim(),
  joined: (one) => `${plural(one.count ?? 0, "paper", "papers")} joined the screening`,
  left: (one) => `${plural(one.count ?? 0, "paper", "papers")} left the screening`,
  rechecked: (one) => `${plural(one.count ?? 0, "settled paper was", "settled papers were")} checked again`,
};

/** Where a change opens: the papers a check brought, the setting it changed, the reviewers, or the paper it is about. */
export function changeOpens(id: string, row: Logged): string | undefined {
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
    case "settings": { const part = (row.more ?? []).find((one) => one.code === "part")?.detail; return settingsHref(id, part && part in SETTING && part !== "name" && part !== "question" ? (part as "papers") : undefined); }
    case "renamed": return settingsHref(id);
  }
  return undefined;
}
