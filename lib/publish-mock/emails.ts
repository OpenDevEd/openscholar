// MOCK (mock/publish-reports): the emails Openscholar Reports sends. The team's inbox hears of what needs a person
// and of what went live; an author hears what a reviewer decided and when their report is live. They are built as the
// contact form's are (lib/contact.ts) and kept in the mock's store to be read. The real build sends each from a Convex
// action through the platform's mail service, as convex/contactMail.ts does.
import { CONTACT_EMAIL } from "@/lib/billing/contact";
import { labelledEmail } from "@/lib/contact";
import type { Email, MockState, Submission } from "./types";

type Row = readonly [string, string];
type Event = { to: "team" | "author"; label: string; heading: string; rows: (report: Submission, origin: string) => Row[] };
const failedOf = (report: Submission) =>
  (report.results ?? []).filter((r) => !r.pass).map((r) => `${r.name}: ${r.reasoning ?? r.detail ?? (r.confidence === undefined ? "failed" : `${Math.round(r.confidence * 100)}% sure of yes`)}`).join("\n") || "None";
const reviewLink = (r: Submission, origin: string): Row => ["Open it", `${origin}/settings/admin/publishing?report=${r.id}`];
const noteOf = (r: Submission): Row[] => (r.note ? [["The reviewer's note", r.note]] : []);

/** What each email is about: who gets it, its name on the report's record, its heading, and what it says. */
const EVENTS = {
  // To the team's inbox.
  "review-requested": {
    to: "team",
    label: "Review requested",
    heading: "An author asked for a human review",
    rows: (r, origin) => [["Checks that failed", failedOf(r)], ["What the author says", r.reviewRequest?.comment || "No comment"], reviewLink(r, origin)],
  },
  "waiting-for-review": { to: "team", label: "Waiting for review", heading: "A report is waiting for review", rows: (r, origin) => [["Checks that flagged it", failedOf(r)], reviewLink(r, origin)] },
  live: { to: "team", label: "Went live", heading: "A report went live", rows: (r, origin) => [["Its page", `${origin}/papers/${r.id}`], reviewLink(r, origin)] },
  "check-unfinished": {
    to: "team",
    label: "A check couldn't finish",
    heading: "A check couldn't finish",
    rows: (r, origin) => [["Checks", (r.results ?? []).filter((c) => c.errored).map((c) => `${c.name}: ${c.detail ?? "failed"}`).join("\n")], reviewLink(r, origin)],
  },
  "pdf-unread": { to: "team", label: "PDF couldn't be read", heading: "A PDF couldn't be read", rows: (r, origin) => [["PDF", r.pdf?.name ?? "Unknown"], reviewLink(r, origin)] },
  "registration-refused": {
    to: "team",
    label: "Registration refused",
    heading: "A DOI registration was refused",
    rows: (r, origin) => [["Refused by", [r.deposit === "failed" ? "Crossref" : "", r.archive === "failed" ? "Zenodo" : ""].filter(Boolean).join(" and ")], reviewLink(r, origin)],
  },
  // To the report's author.
  approved: { to: "author", label: "Approved", heading: "A reviewer approved your report", rows: (_r, origin) => [["What to do next", `Open Publish and press Activate to make your DOI live.\n${origin}/publish`]] },
  declined: { to: "author", label: "Declined", heading: "Your report was declined", rows: (r) => noteOf(r) },
  withdrawn: { to: "author", label: "Withdrawn", heading: "Your report was withdrawn", rows: (r) => noteOf(r) },
  reinstated: { to: "author", label: "Reinstated", heading: "Your report is live again", rows: (r, origin) => [["Its page", `${origin}/papers/${r.id}`]] },
  "live-author": { to: "author", label: "Live", heading: "Your report is live", rows: (r, origin) => [["Its DOI", `https://doi.org/${r.doi}`], ["Its page", `${origin}/papers/${r.id}`]] },
} as const satisfies Record<string, Event>;
export type MailEvent = keyof typeof EVENTS;

/** Sends one email about a report: to the team's inbox with replies going to the author, or to the author with replies going to the team. */
export function mail(state: MockState, event: MailEvent, report: Submission, origin: string) {
  const { to, label, heading, rows }: Event = EVENTS[event];
  const author = report.signedBy?.email ?? "";
  // An author with no address on their signature can't be written to.
  if (to === "author" && !author) return;
  const title = report.metadata?.title || report.pdf?.name || report.id;
  const email: Email = {
    id: crypto.randomUUID(),
    at: Date.now(),
    audience: to,
    to: to === "team" ? CONTACT_EMAIL : author,
    replyTo: to === "team" ? author : CONTACT_EMAIL,
    subject: `${label}: ${title}${to === "team" ? ` (${report.id})` : ""}`,
    report: report.id,
    event: label,
    ...labelledEmail(heading, [
      ["Report", `${title}\n${report.id}, https://doi.org/${report.doi}`],
      ...(to === "team" ? ([["Author", `${report.signedBy?.name ?? "Unknown"}${author ? ` <${author}>` : ""}`]] as Row[]) : []),
      ...rows(report, origin),
    ]),
  };
  // The newest 300: the mock's store is one file.
  state.outbox = [email, ...(state.outbox ?? [])].slice(0, 300);
}
