// The email to someone who sent a paper to a community, once its team answers, in the community's own frame (./library-template.ts).
import { escapeHtml } from "@/lib/escape-html";
import { emailButton, emailPanel, emailStyles, renderLibraryEmail, type LibraryEmailIdentity } from "./library-template";

const quote = (text: string) =>
	`<blockquote style="margin:0 0 24px;padding:4px 0 4px 16px;border-left:3px solid #e2e3dc;font-size:15px;line-height:1.7;color:#424c45;white-space:pre-line">${escapeHtml(text)}</blockquote>`;

/** The paper is live, with the way to open it; or it wasn't added, with the team's reason when they gave one. */
export function renderSuggestionAnswer({ identity, paper, published, reason, url }: { identity: LibraryEmailIdentity; paper: { title: string; authors: string; year: number | null }; published: boolean; reason: string | null; /** Its record on the community once published; Your submissions otherwise. */ url: string }) {
	const name = `<strong style="color:#202822">${escapeHtml(identity.name)}</strong>`;
	const panel = emailPanel(paper.title, [paper.authors, paper.year].filter(Boolean).join(", "), "The paper you suggested");
	const content = published
		? `<p style="${emailStyles.paragraph}">${name} published a paper you suggested.</p>${panel}${emailButton("Open the paper", url, identity.accent)}`
		: `<p style="${emailStyles.paragraph}">${name} didn’t add a paper you suggested.</p>${panel}${reason ? `<p style="font-size:13px;color:#797b73;margin:0 0 8px">Their reason</p>${quote(reason)}` : ""}${emailButton("Open your submissions", url, identity.accent)}`;
	return renderLibraryEmail({
		identity,
		title: published ? "Your suggestion is live" : "About your suggestion",
		content,
		footerHtml: "You received this email because you suggested a paper to the community.",
	});
}
