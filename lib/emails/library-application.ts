// The emails about applications to join a community (OS-31), in the community's own frame (./library-template.ts).
import { escapeHtml } from "@/lib/escape-html";
import { emailButton, emailPanel, emailStyles, renderLibraryEmail, type LibraryEmailIdentity } from "./library-template";

const quote = (text: string) =>
	`<blockquote style="margin:0 0 24px;padding:4px 0 4px 16px;border-left:3px solid #e2e3dc;font-size:15px;line-height:1.7;color:#424c45;white-space:pre-line">${escapeHtml(text)}</blockquote>`;

/** To its owners and editors: someone applied, with their message, and where to answer. */
export function renderApplicationReceived({ identity, applicant, message, reviewUrl }: { identity: LibraryEmailIdentity; applicant: { name: string; email: string }; message: string; reviewUrl: string }) {
	return renderLibraryEmail({
		identity,
		title: "Someone wants to join the community",
		content: `<p style="${emailStyles.paragraph}"><strong style="color:#202822">${escapeHtml(applicant.name)}</strong> (${escapeHtml(applicant.email)}) applied to join <strong style="color:#202822">${escapeHtml(identity.name)}</strong> as a Creator.</p>${quote(message)}${emailButton("Review applications", reviewUrl, identity.accent)}<p style="font-size:13px;line-height:1.7;color:#797b73;margin:22px 0 0">Accepting makes them a Creator: they can add papers, edit records and submit work for review. They get an email with your answer.</p>`,
		footerHtml: "You received this email because you’re an owner or editor of the community.",
	});
}

/** To the applicant: the answer, and the reason when it's a no. */
export function renderApplicationAnswer({ identity, accepted, reason, appliesAgainOn, url }: { identity: LibraryEmailIdentity; accepted: boolean; reason: string | null; appliesAgainOn: string; url: string }) {
	const content = accepted
		? `<p style="${emailStyles.paragraph}">Your application to join <strong style="color:#202822">${escapeHtml(identity.name)}</strong> was accepted.</p>${emailPanel("Creator", "Add papers, edit records, upload files and submit your work for review.", "Your community role")}${emailButton("Open your communities", url, identity.accent)}`
		: `<p style="${emailStyles.paragraph}">Your application to join <strong style="color:#202822">${escapeHtml(identity.name)}</strong> wasn’t accepted.</p>${reason ? `<p style="font-size:13px;color:#797b73;margin:0 0 8px">Their reason</p>${quote(reason)}` : ""}<p style="${emailStyles.paragraph}">You can apply again from ${escapeHtml(appliesAgainOn)}.</p>${emailButton("Open your communities", url, identity.accent)}`;
	return renderLibraryEmail({
		identity,
		title: accepted ? "You’re in" : "About your application",
		content,
		footerHtml: "You received this email because you applied to join the community.",
	});
}
