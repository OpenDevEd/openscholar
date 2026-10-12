import { escapeHtml } from "../escape-html";
import { emailButton, emailPanel, emailStyles, renderLibraryEmail, type LibraryEmailIdentity } from "./library-template";

/**
 * The email that invites someone to a reader's collection in an Evidence Library
 * (convex/evidenceLibraries/collectionInvitationMail.ts), in the library's name and look, with
 * the role names the library shows.
 */
export function collectionInvitationMessage({ identity, acceptUrl, email, collectionName, role, inviter }: {
  identity: LibraryEmailIdentity;
  /** The library's own page for the invitation, where it is accepted. */
  acceptUrl: string;
  email: string;
  collectionName: string;
  role: "viewer" | "editor";
  inviter: string;
}) {
  const [label, can] = role === "editor"
    ? ["Can edit", "Read the collection, add records to it and take them out."]
    : ["Can view", "Read the collection and its records, even while it is private."];
  return {
    subject: `${inviter} shared "${collectionName}" with you`,
    text: `${inviter} shared the collection "${collectionName}" with you in ${identity.name}.\n\n${can}\n\nSign in with ${email} to open it:\n${acceptUrl}\n\nThis invitation expires in seven days.`,
    html: renderLibraryEmail({
      identity,
      title: `${inviter} shared a collection with you`,
      content: `<p style="${emailStyles.paragraph}"><strong style="color:#202822">${escapeHtml(collectionName)}</strong> in ${escapeHtml(identity.name)}</p>${emailPanel(label, can, "Your role")}${emailButton("Open invitation", acceptUrl, identity.accent)}<p style="font-size:13px;line-height:1.7;color:#797b73;margin:22px 0 0">Sign in with ${escapeHtml(email)}. Your invitation expires in 7 days.</p>`,
      footerHtml: `You received this email because ${escapeHtml(inviter)} shared a collection with you in ${escapeHtml(identity.name)}. If you weren’t expecting it, you can ignore it.`,
    }),
  };
}
