// MOCK (mock/publish-reports): the emails Openscholar Reports sends the team's inbox, so the team can follow what
// happens. They are built here as the contact form's are (lib/contact.ts) and kept in the mock's store to be read.
// The real build sends each one from a Convex action through the platform's mail service, as convex/contactMail.ts does.
import { CONTACT_EMAIL } from "@/lib/billing/contact";
import { labelledEmail } from "@/lib/contact";
import type { Email, Submission } from "./types";

/** An author asked a person to look at a report its checks failed. Replies go to the author. */
export function reviewRequestedEmail(report: Submission, origin: string): Email {
  const title = report.metadata?.title || report.pdf?.name || report.id;
  const failed = (report.results ?? []).filter((r) => !r.pass).map((r) => `${r.name}: ${r.reasoning ?? r.detail ?? (r.confidence === undefined ? "failed" : `${Math.round(r.confidence * 100)}% sure of yes`)}`);
  const rows: Array<readonly [string, string]> = [
    ["Report", `${title}\n${report.id}, https://doi.org/${report.doi}`],
    ["Author", `${report.signedBy?.name ?? "Unknown"}${report.signedBy?.email ? ` <${report.signedBy.email}>` : ""}`],
    ["Checks that failed", failed.join("\n") || "None"],
    ["What the author says", report.reviewRequest?.comment || "No comment"],
    ["Review it", `${origin}/settings/admin/publishing`],
  ];
  return {
    id: crypto.randomUUID(),
    at: Date.now(),
    to: CONTACT_EMAIL,
    replyTo: report.signedBy?.email ?? "",
    subject: `Review requested: ${title} (${report.id})`,
    report: report.id,
    ...labelledEmail("An author asked for a human review", rows),
  };
}
