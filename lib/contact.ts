// The contact form on openscholar.ai/contact (marketing/src/components/ContactBody.astro): what it may send, checked
// where it's sent from (convex/contact.ts), and the email it becomes for the team's inbox.
import { z } from "zod";
import { escapeHtml } from "./escape-html";

/** Each topic the form offers, by the id its address and request name it with (/contact/?topic=southern). */
export const CONTACT_TOPICS = {
  community: "Start an Evidence Community",
  southern: "Southern plan",
  partner: "Research and partnerships",
  account: "Help with your account",
  bug: "Report a problem",
  other: "Something else",
} as const;
export type ContactTopic = keyof typeof CONTACT_TOPICS;

/** The topics that ask about a project, which they need at least this much of; the rest need a message instead. */
const PROJECT_TOPICS = new Set<ContactTopic>(["community", "southern", "partner"]);
const PROJECT_MIN = 20;

const text = (max: number) => z.string().trim().max(max);
const optional = (max: number) => text(max).optional().transform((value) => value || undefined);

/** A message as the form sends it, with the form's own limits. */
export const contactMessage = z
  .object({
    topic: z.enum(Object.keys(CONTACT_TOPICS) as [ContactTopic, ...ContactTopic[]]),
    name: text(120).min(1),
    email: z.email().max(254),
    org: optional(160),
    country: optional(80),
    project: optional(3_000),
    message: optional(3_000),
  })
  .strict()
  .superRefine((form, ctx) => {
    if (PROJECT_TOPICS.has(form.topic) ? (form.project?.length ?? 0) < PROJECT_MIN : !form.message) {
      ctx.addIssue({ code: "custom", path: [PROJECT_TOPICS.has(form.topic) ? "project" : "message"], message: "Required" });
    }
    if (form.topic === "southern" && !form.country) ctx.addIssue({ code: "custom", path: ["country"], message: "Required" });
  });
export type ContactMessage = z.infer<typeof contactMessage>;

const LABELS: Array<[keyof ContactMessage, string]> = [["name", "Name"], ["email", "Email"], ["org", "Organisation"], ["country", "Country"], ["project", "Project"], ["message", "Message"]];

/** A web address in already-escaped text, made a link, so a reader opens it with one click. The full stop or
 * bracket that ends a sentence after it stays outside. */
const linked = (escaped: string) => escaped.replace(/https?:\/\/[^\s<]*[^\s<.,;:!?)'"]/g, (url) => `<a href="${url}" style="color:#c2410c">${url}</a>`);

/** An email of labelled values: a heading, then each value under its label. The body, as text and as HTML. */
export function labelledEmail(heading: string, rows: ReadonlyArray<readonly [label: string, value: string]>) {
  return {
    text: [heading, ...rows.map(([label, value]) => `${label}:\n${value}`)].join("\n\n"),
    html: `<p style="margin:0 0 20px;font:600 15px/1.4 sans-serif">${escapeHtml(heading)}</p>${rows
      .map(([label, value]) => `<p style="margin:0 0 4px;font:13px/1.4 sans-serif;color:#6a6a6a">${escapeHtml(label)}</p><p style="margin:0 0 18px;font:15px/1.5 sans-serif;white-space:pre-wrap">${linked(escapeHtml(value))}</p>`)
      .join("")}`,
  };
}

/** The email a message becomes: its topic and sender in the subject, then each answer under its label. */
export function contactEmail(form: ContactMessage) {
  const rows = LABELS.flatMap(([key, label]) => (form[key] ? [[label, String(form[key])] as const] : []));
  const body = labelledEmail(CONTACT_TOPICS[form.topic], rows);
  return { subject: `${CONTACT_TOPICS[form.topic]}: ${form.name}`, text: `Topic: ${body.text}`, html: body.html };
}
