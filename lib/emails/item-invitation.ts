import { escapeHtml } from "../escape-html";
import type { SharedKind } from "../../convex/sharing/validators";
import { emailButton, emailPanel, emailStyles, renderLibraryEmail } from "./library-template";

/** The email that invites someone to one item (convex/sharing/mail.ts): who shares what, what they may do with it, and the link to answer. */
/** What an editor of each kind of item may do, as the share dialog offers it (convex/sharing/guests.ts): a screening's editor votes on its papers, and changes nothing else. An extraction is shared to view only. */
const EDITS: Record<SharedKind, [label: string, can: string]> = {
  collection: ["Can edit", "Open, read and export this collection, and put papers in it and take them out."],
  screening: ["Can vote", "Open, read and export this screening, and vote on the papers as one of the reviewers."],
  search: ["Can edit", "Open, read and export this search, and change the query, filters, questions and answers."],
  chat: ["Can edit", "Open and read this chat, and write in it."],
  author: ["Can edit", "Edit this author profile."],
  extraction: ["Can view", "Open, read and export this extraction."],
};

export function itemInvitationMessage({ origin, invitationId, email, kind, word, name, role, inviter, workspace, finished = false }: {
  origin: string;
  invitationId: string;
  email: string;
  kind: SharedKind;
  /** The word for the item in a sentence, such as "collection". */
  word: string;
  name: string;
  role: "viewer" | "editor";
  inviter: string;
  workspace: string;
  /** A screening marked finished: its reviewers vote once it is reopened. */
  finished?: boolean;
}) {
  const acceptUrl = new URL(`/shared/${invitationId}`, origin).href;
  const identity = { name: "Openscholar", baseUrl: origin, logoUrl: new URL("/web-app-manifest-192x192.png", origin).href, accent: "#ed7b15" };
  const [label, can] = role === "editor" ? EDITS[kind] : ["Can view", `Open, read and export this ${word}.`];
  // Voting costs a screening's reviewers nothing: the workspace that runs it pays for its models. Anything else run on a shared item uses the person's own credits.
  const votes = kind === "screening" && role === "editor";
  const paying = votes ? `Voting is free. ${workspace || inviter} pays for the screening's AI models.` : `Anything you run on it uses your own credits.`;
  const when = votes && finished ? " The screening is finished for now: you can vote once it is reopened." : "";
  const from = workspace && workspace !== inviter ? ` from ${workspace}` : "";
  return {
    subject: `${inviter} shared "${name}" with you`,
    text: `${inviter} shared the ${word} "${name}"${from} with you on Openscholar.\n\n${can}${when}\n\nSign in with ${email} to open it:\n${acceptUrl}\n\nThis invitation expires in seven days. It gives access to this ${word} only. ${paying}`,
    html: renderLibraryEmail({
      identity,
      title: `${inviter} shared a ${word} with you`,
      content: `<p style="${emailStyles.paragraph}"><strong style="color:#202822">${escapeHtml(name)}</strong>${escapeHtml(from)}</p>${emailPanel(label, `${can}${when} ${paying}`, "Your access")}${emailButton("Open invitation", acceptUrl, identity.accent)}<p style="font-size:13px;line-height:1.7;color:#797b73;margin:22px 0 0">Sign in with ${escapeHtml(email)}. Your invitation expires in 7 days.</p>`,
      footerHtml: `You received this email because ${escapeHtml(inviter)} invited you to a ${escapeHtml(word)} on Openscholar. If you weren’t expecting it, you can ignore it.`,
    }),
  };
}
