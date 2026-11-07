// A community's invitation for an organization (#1091), in the community's own email look
// (./library-template.ts, shared with new-el): the reader accepts it for an organization they're an
// admin of, and everyone in it gets the role.
import { escapeHtml } from "../escape-html";
import { emailButton, emailPanel, emailStyles, renderLibraryEmail, type LibraryEmailIdentity } from "./library-template";

export function renderOrganizationInvitation({ identity, role, acceptUrl }: { identity: LibraryEmailIdentity; role: "editor" | "creator"; acceptUrl: string }) {
	const description =
		role === "editor"
			? "Create and edit items, review submissions and publish approved work."
			: "Create and edit items, upload files and submit work for review.";
	return renderLibraryEmail({
		identity,
		title: "Your organization is invited to the community",
		content: `<p style="${emailStyles.paragraph}">Your organization has been invited to contribute to <strong style="color:#202822">${escapeHtml(identity.name)}</strong>. Accept it for an organization you’re an admin of, and everyone in it gets this role.</p>${emailPanel(role === "editor" ? "Editor" : "Creator", description, "Your organization’s role")}${emailButton("View invitation", acceptUrl, identity.accent)}<p style="font-size:13px;line-height:1.7;color:#797b73;margin:22px 0 0">Sign in with the email address that received this invitation. Your invitation expires in 7 days.</p>`,
		footerHtml: "You received this email because your organization was invited to the community.",
	});
}
