import { escapeHtml } from "../escape-html";
import { emailButton, emailPanel, emailStyles, renderLibraryEmail } from "./library-template";

export function authorInvitationMessage({ origin, profileId, profileName, email }: {
  origin: string;
  profileId: string;
  profileName: string;
  email: string;
}) {
  const acceptUrl = new URL(`/authors/${profileId}/invitation`, origin).href;
  const identity = {
    name: profileName,
    baseUrl: new URL(`/authors/${profileId}`, origin).href,
    logoUrl: new URL("/web-app-manifest-192x192.png", origin).href,
    accent: "#2563eb",
  };
  return {
    subject: `Invitation to edit ${profileName}`,
    text: `You have been invited to edit the author profile for ${profileName}.\n\nSign in with ${email} to view and accept the invitation:\n${acceptUrl}\n\nThis invitation expires in seven days. It grants access to this profile only.`,
    html: renderLibraryEmail({
      identity,
      title: "You’re invited to edit an author profile",
      content: `<p style="${emailStyles.paragraph}">Collaborate on <strong style="color:#202822">${escapeHtml(profileName)}</strong>’s OpenScholar profile.</p>${emailPanel("Profile editor", "Edit profile details and select publications. This invitation grants access to this profile only.", "Your access")}${emailButton("View invitation", acceptUrl, identity.accent)}<p style="font-size:13px;line-height:1.7;color:#797b73;margin:22px 0 0">Sign in with ${escapeHtml(email)}. Your invitation expires in 7 days.</p>`,
      footerHtml: "You received this email because you were invited to edit an author profile. If you weren’t expecting it, you can ignore it.",
    }),
  };
}
