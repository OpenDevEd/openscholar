// The emails Openscholar Reports sends (plans/publish-reports). The team's inbox hears of what needs a person and of
// what went live; an author hears what a reviewer decided and when their report or their changes are live. They are
// laid out as the contact form's are (lib/contact.ts) and sent by convex/reports/mailer.ts.
import { CONTACT_EMAIL } from "../billing/contact";
import { labelledEmail } from "../contact";
import type { CheckResult } from "./report";

/** What an email says of its report, as the report stood when the email was written. */
export type MailFacts = {
  key: string;
  doi: string;
  title: string;
  /** It has gone live, so its DOI leads somewhere. */
  activated: boolean;
  live: boolean;
  signer: string;
  /** The account that started it: an author with no address can't be written to. */
  authorEmail: string | null;
  pdfName?: string;
  results: CheckResult[];
  /** What the author wrote when asking for a person. */
  request?: string;
  /** A reviewer's note with their last decision. */
  note?: string;
  /** Changes to a live report that haven't gone live. */
  correction?: { changed: string[]; results: CheckResult[]; request?: string; declinedNote?: string };
  deposit: string;
  archive: string;
  /** What a reviewer changed, for the email that says they edited the details. */
  edited?: string;
};

type Row = readonly [string, string];
type Event = { to: "team" | "author"; label: string; heading: string; rows: (report: MailFacts, origin: string) => Row[] };

/** Each check that didn't pass, with how far it fell short and why, or `none` when every check passed. */
const failedIn = (results: CheckResult[] | undefined, none: string) =>
  (results ?? [])
    .filter((r) => !r.pass)
    .map((r) => `${r.name}: ${[r.confidence === undefined || r.threshold === undefined ? "" : `${Math.round(r.confidence * 100)}% sure of yes, needs ${Math.round(r.threshold * 100)}%.`, r.reasoning ?? r.detail ?? ""].filter(Boolean).join(" ") || "failed"}`)
    .join("\n") || none;
// Every link opens the thing its email is about: the report's dialog for a reviewer, and for its author the report
// on Publish where its next step is, or its own page once it's live.
const reviewLink = (r: MailFacts, origin: string): Row => ["Open it", `${origin}/settings/admin/publishing?report=${r.key}`];
const publishLink = (label: string, r: MailFacts, origin: string): Row => [label, `${origin}/publish?report=${r.key}`];
const pageLink = (r: MailFacts, origin: string): Row => ["Its page", `${origin}/papers/${r.key}`];
const noteOf = (note: string | undefined): Row[] => (note ? [["The reviewer's note", note]] : []);
/** Replies to an author's email reach the team's inbox. */
const QUESTIONS: Row = ["Questions", "Reply to this email."];
const changesRows = (r: MailFacts, origin: string): Row[] => [
  ["What changed", r.correction?.changed.join(", ") || "Nothing"],
  ["Checks that didn't pass", failedIn(r.correction?.results, "None. Human review is on, so changes wait for a reviewer.")],
  ...(r.correction?.request !== undefined ? ([["What the author says", r.correction.request || "No comment"]] as Row[]) : []),
  reviewLink(r, origin),
];

/** What each email is about: who gets it, its name on the report's record, its heading, and what it says. */
const EVENTS = {
  // To the team's inbox.
  "review-requested": {
    to: "team",
    label: "Review requested",
    heading: "An author asked for a human review",
    rows: (r, origin) => [["Checks that failed", failedIn(r.results, "None")], ["What the author says", r.request || "No comment"], reviewLink(r, origin)],
  },
  "waiting-for-review": {
    to: "team",
    label: "Waiting for review",
    heading: "A report is waiting for review",
    rows: (r, origin) => [["Checks that didn't pass", failedIn(r.results, "None. Human review is on, so every report waits for a reviewer.")], reviewLink(r, origin)],
  },
  "changes-waiting": { to: "team", label: "Changes waiting for review", heading: "Changes to a live report are waiting for review", rows: changesRows },
  "changes-review-requested": { to: "team", label: "Review of changes requested", heading: "An author asked for a review of changes to a live report", rows: changesRows },
  live: { to: "team", label: "Went live", heading: "A report went live", rows: (r, origin) => [pageLink(r, origin), reviewLink(r, origin)] },
  "check-unfinished": {
    to: "team",
    label: "A check couldn't finish",
    heading: "A check couldn't finish",
    rows: (r, origin) => [
      ["Checks", [...r.results, ...(r.correction?.results ?? [])].filter((c) => c.errored).map((c) => c.name).join("\n")],
      ["What happens now", "Another check stopped it, so nothing is waiting for review. The author can run the checks again."],
      reviewLink(r, origin),
    ],
  },
  "pdf-unopened": {
    to: "team",
    label: "PDF couldn't be opened",
    heading: "A PDF couldn't be opened",
    rows: (r, origin) => [["PDF", r.pdfName ?? "Unknown"], ["What happened", "The file couldn't be opened as a PDF. The author was asked to save it again as a PDF and upload that."], reviewLink(r, origin)],
  },
  "pdf-unread": {
    to: "team",
    label: "Details couldn't be read",
    heading: "A PDF's details couldn't be read",
    rows: (r, origin) => [["PDF", r.pdfName ?? "Unknown"], ["What happened", "Openscholar couldn't read the details from the PDF. The author is filling them in."], reviewLink(r, origin)],
  },
  "registration-refused": {
    to: "team",
    label: "Registration refused",
    heading: "A DOI registration was refused",
    rows: (r, origin) => [["Refused by", [r.deposit === "failed" ? "Crossref" : "", r.archive === "failed" ? "Zenodo" : ""].filter(Boolean).join(" and ")], reviewLink(r, origin)],
  },
  // To the report's author.
  approved: { to: "author", label: "Approved", heading: "A reviewer approved your report", rows: (r, origin) => [publishLink("Activate it to make its DOI live", r, origin)] },
  released: {
    to: "author",
    label: "Ready to activate",
    heading: "Your report can be activated now",
    rows: (r, origin) => [["What changed", "Reports no longer wait for a reviewer, and yours passed its checks."], publishLink("Activate it to make its DOI live", r, origin)],
  },
  declined: { to: "author", label: "Declined", heading: "A reviewer declined your report", rows: (r, origin) => [...noteOf(r.note), publishLink("Your report and what its checks said", r, origin), QUESTIONS] },
  withdrawn: {
    to: "author",
    label: "Withdrawn",
    heading: "A reviewer withdrew your report",
    rows: (r, origin) => [...noteOf(r.note), ["What happens now", "Its page says it was withdrawn. Its DOI keeps leading there."], pageLink(r, origin), QUESTIONS],
  },
  reinstated: { to: "author", label: "Reinstated", heading: "Your report is live again", rows: (r, origin) => [pageLink(r, origin)] },
  "live-author": {
    to: "author",
    label: "Live",
    heading: "Your report is live",
    rows: (r, origin) => [pageLink(r, origin), ["Its DOI", `https://doi.org/${r.doi}\nIt starts working once it's registered, which can take a few minutes.`]],
  },
  "changes-live": { to: "author", label: "Changes live", heading: "Your changes are live", rows: (r, origin) => [pageLink(r, origin)] },
  "details-edited": {
    to: "author",
    label: "Details edited",
    heading: "A reviewer edited your report's details",
    rows: (r, origin) => [["What changed", r.edited || "Its details"], r.live ? pageLink(r, origin) : publishLink("Your report", r, origin), QUESTIONS],
  },
  "changes-declined": {
    to: "author",
    label: "Changes declined",
    heading: "A reviewer declined your changes",
    rows: (r, origin) => [...noteOf(r.correction?.declinedNote), ["What happens now", "Your report stays live as it was. Change the details and send them again, or discard the changes."], publishLink("Your changes", r, origin), QUESTIONS],
  },
} as const satisfies Record<string, Event>;

export type MailEvent = keyof typeof EVENTS;
export const MAIL_EVENTS = Object.keys(EVENTS) as [MailEvent, ...MailEvent[]];
/** Who an email is for and what it is called on the report's record. */
export const mailAbout = (event: MailEvent): Pick<Event, "to" | "label"> => EVENTS[event];

/**
 * One email about a report: to the team's inbox with replies going to the author, or to the author with replies
 * going to the team. Null for an author with no address. `origin` is the site's address: a link in an email is never
 * relative.
 */
export function reportEmail(event: MailEvent, report: MailFacts, origin: string) {
  const { to, label, heading, rows }: Event = EVENTS[event];
  const author = report.authorEmail ?? "";
  if (to === "author" && !author) return null;
  const site = origin.replace(/\/+$/, "");
  return {
    audience: to,
    label,
    to: to === "team" ? CONTACT_EMAIL : author,
    // No reply address is better than a wrong one: the team's email about an author without an address replies to the team.
    replyTo: to === "team" ? author || CONTACT_EMAIL : CONTACT_EMAIL,
    // The team tells one report's emails apart by its key; an author reads what happened, and to which report.
    subject: to === "team" ? `${label}: ${report.title} (${report.key})` : `${heading}: ${report.title}`,
    ...labelledEmail(heading, [
      // A DOI leads somewhere only once its report has gone live: until then it's given as text, not as a link.
      ["Report", `${report.title}\n${report.key}, ${report.activated ? `https://doi.org/${report.doi}` : `DOI ${report.doi}, reserved`}`],
      ...(to === "team" ? ([["Author", `${report.signer}${author ? ` <${author}>` : ""}`]] as Row[]) : []),
      ...rows(report, site),
    ]),
  };
}
