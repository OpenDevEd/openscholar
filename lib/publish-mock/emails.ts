// MOCK (mock/publish-reports): the emails Openscholar Reports sends the team's inbox, so the team can follow what
// needs a person and what went live. They are built as the contact form's are (lib/contact.ts) and kept in the mock's
// store to be read. The real build sends each from a Convex action through the platform's mail service, as
// convex/contactMail.ts does.
import { CONTACT_EMAIL } from "@/lib/billing/contact";
import { labelledEmail } from "@/lib/contact";
import type { Email, MockState, Submission } from "./types";

type Row = readonly [string, string];
const failedOf = (report: Submission) =>
  (report.results ?? []).filter((r) => !r.pass).map((r) => `${r.name}: ${r.reasoning ?? r.detail ?? (r.confidence === undefined ? "failed" : `${Math.round(r.confidence * 100)}% sure of yes`)}`).join("\n") || "None";

/** What each email is about: its name on the report's record, its heading, and what it adds to the report and its author. */
const EVENTS = {
  "review-requested": {
    label: "Review requested",
    heading: "An author asked for a human review",
    rows: (r: Submission): Row[] => [["Checks that failed", failedOf(r)], ["What the author says", r.reviewRequest?.comment || "No comment"]],
  },
  "waiting-for-review": { label: "Waiting for review", heading: "A report is waiting for review", rows: (r: Submission): Row[] => [["Checks that flagged it", failedOf(r)]] },
  live: { label: "Went live", heading: "A report went live", rows: (): Row[] => [] },
  "check-unfinished": {
    label: "A check couldn't finish",
    heading: "A check couldn't finish",
    rows: (r: Submission): Row[] => [["Checks", (r.results ?? []).filter((c) => c.errored).map((c) => `${c.name}: ${c.detail ?? "failed"}`).join("\n")]],
  },
  "pdf-unread": { label: "PDF couldn't be read", heading: "A PDF couldn't be read", rows: (r: Submission): Row[] => [["PDF", `${r.pdf?.name ?? "Unknown"}\nIts details were left for the author to fill in.`]] },
  "registration-refused": {
    label: "Registration refused",
    heading: "A DOI registration was refused",
    rows: (r: Submission): Row[] => [["Refused by", [r.deposit === "failed" ? "Crossref" : "", r.archive === "failed" ? "Zenodo" : ""].filter(Boolean).join(" and ")]],
  },
} as const;
export type MailEvent = keyof typeof EVENTS;

/** Tells the team's inbox about a report. Replies go to its author. */
export function mail(state: MockState, event: MailEvent, report: Submission, origin: string) {
  const { label, heading, rows } = EVENTS[event];
  const title = report.metadata?.title || report.pdf?.name || report.id;
  const email: Email = {
    id: crypto.randomUUID(),
    at: Date.now(),
    to: CONTACT_EMAIL,
    replyTo: report.signedBy?.email ?? "",
    subject: `${label}: ${title} (${report.id})`,
    report: report.id,
    event: label,
    ...labelledEmail(heading, [
      ["Report", `${title}\n${report.id}, https://doi.org/${report.doi}`],
      ["Author", `${report.signedBy?.name ?? "Unknown"}${report.signedBy?.email ? ` <${report.signedBy.email}>` : ""}`],
      ...rows(report),
      event === "live" ? ["Its page", `${origin}/papers/${report.id}`] : ["Open it", `${origin}/settings/admin/publishing`],
    ]),
  };
  // The newest 200: the mock's store is one file.
  state.outbox = [email, ...(state.outbox ?? [])].slice(0, 200);
}
