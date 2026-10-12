import { escapeHtml } from "../escape-html";
import { emailButton, emailPanel, emailStyles, renderLibraryEmail } from "./library-template";

/** The email that invites someone to one item (convex/sharing/mail.ts): who shares what, what they may do with it, and the link to answer. */
export function itemInvitationMessage({ origin, invitationId, email, kind, name, role, inviter, workspace }: {
  origin: string;
  invitationId: string;
  email: string;
  /** The word for the item in a sentence, such as "collection". */
  kind: string;
  name: string;
  role: "viewer" | "editor";
  inviter: string;
  workspace: string;
}) {
  const acceptUrl = new URL(`/shared/${invitationId}`, origin).href;
  const identity = { name: "OpenScholar", baseUrl: origin, logoUrl: new URL("/web-app-manifest-192x192.png", origin).href, accent: "#2563eb" };
  // What each role does today: an editor's jobs on a shared item aren't built yet.
  const can = role === "editor" ? `Open, read and export this ${kind}, put papers in it and take them out.` : `Open, read and export this ${kind}.`;
  const from = workspace && workspace !== inviter ? ` from ${workspace}` : "";
  return {
    subject: `${inviter} shared "${name}" with you`,
    text: `${inviter} shared the ${kind} "${name}"${from} with you on OpenScholar.\n\n${can}\n\nSign in with ${email} to open it:\n${acceptUrl}\n\nThis invitation expires in seven days. It gives access to this ${kind} only, and anything you run on it uses your own credits.`,
    html: renderLibraryEmail({
      identity,
      title: `${inviter} shared a ${kind} with you`,
      content: `<p style="${emailStyles.paragraph}"><strong style="color:#202822">${escapeHtml(name)}</strong>${escapeHtml(from)}</p>${emailPanel(role === "editor" ? "Can edit" : "Can view", `${can} Anything you run on it uses your own credits.`, "Your access")}${emailButton("Open invitation", acceptUrl, identity.accent)}<p style="font-size:13px;line-height:1.7;color:#797b73;margin:22px 0 0">Sign in with ${escapeHtml(email)}. Your invitation expires in 7 days.</p>`,
      footerHtml: `You received this email because ${escapeHtml(inviter)} invited you to a ${escapeHtml(kind)} on OpenScholar. If you weren’t expecting it, you can ignore it.`,
    }),
  };
}
