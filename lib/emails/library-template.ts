// Generated from OpenDevEd/new-el src/lib/emails/library-template.ts.
// Regenerate with: node scripts/sync-library-email-template.mjs <new-el checkout>
import { escapeHtml } from "@/lib/escape-html";

export type LibraryEmailIdentity = {
	name: string;
	baseUrl: string;
	logoUrl: string;
	accent: string;
};
export const emailStyles = {
	paragraph: "font-size:16px;line-height:1.75;color:#555653;margin:0 0 20px",
	heading: "font-size:21px;line-height:1.3;margin:28px 0 12px;color:#1c2421",
	link: "color:#994b0d;text-decoration:underline;text-underline-offset:3px",
};

export function emailButton(label: string, href: string, color: string) {
	const accent = /^#[0-9a-f]{6}$/i.test(color) ? color : "#f58220";
	const [r, g, b] = [1, 3, 5].map((offset) => {
		const value = parseInt(accent.slice(offset, offset + 2), 16) / 255;
		return value <= 0.04045
			? value / 12.92
			: ((value + 0.055) / 1.055) ** 2.4;
	});
	const light = r! * 0.2126 + g! * 0.7152 + b! * 0.0722;
 const text = (light + 0.05) / 0.0575 >= 4.5 ? "#151515" : 1.05 / (light + 0.05) >= 4.5 ? "#ffffff" : "#000000";
	return `<table role="presentation" cellspacing="0" cellpadding="0"><tr><td bgcolor="${escapeHtml(accent)}" style="border-radius:10px"><a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 22px;font-size:15px;font-weight:700;color:${text};text-decoration:none;border:1px solid ${escapeHtml(accent)};border-radius:10px">${escapeHtml(label)}</a></td></tr></table>`;
}

export function emailPanel(title: string, description: string, label?: string) {
	return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f7f3;border-radius:12px;margin:26px 0"><tr><td style="padding:22px">${label ? `<p style="margin:0 0 8px;font-size:13px;color:#797b73">${escapeHtml(label)}</p>` : ""}<p style="margin:0 0 8px;font-size:21px;font-weight:700;color:#202822">${escapeHtml(title)}</p><p style="font-size:14px;line-height:1.7;margin:0;color:#555653">${escapeHtml(description)}</p></td></tr></table>`;
}

/** The approved email frame, shared by previews and actual messages. Content is rendered HTML; metadata is escaped here. */
export function renderLibraryEmail({
	identity,
	title,
	content,
	detail,
	footerHtml,
}: {
	identity: LibraryEmailIdentity;
	title: string;
	content: string;
	detail?: { dateRange: string; publicationCount: number };
	footerHtml: string;
}) {
	const name = escapeHtml(identity.name),
		base = identity.baseUrl,
		host = new URL(base).hostname;
	const accent = /^#[0-9a-f]{6}$/i.test(identity.accent)
		? identity.accent
		: "#f58220";
	return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@400;500;700&display=swap" rel="stylesheet"><!--<![endif]--><style>body,table,td,a{font-family:Ubuntu,Arial,Helvetica,sans-serif}@media(max-width:520px){.shell{padding:12px!important}.inner{padding:24px!important}.title{font-size:28px!important}}body{margin:0}a:focus{outline:2px solid ${accent};outline-offset:4px}</style><!--[if mso]><style>body,table,td,a{font-family:Arial,Helvetica,sans-serif!important}</style><![endif]--></head><body style="margin:0;background:#efefea;font-family:Ubuntu,Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td class="shell" style="padding:36px 20px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#fff;border-radius:18px;overflow:hidden"><tr><td class="inner" style="padding:30px 36px;border-bottom:1px solid #eceee7"><a href="${escapeHtml(base)}" style="text-decoration:none;color:#202822"><table role="presentation" cellspacing="0" cellpadding="0"><tr>${/\.(?:png|jpe?g|gif)(?:[?#]|$)/i.test(identity.logoUrl) ? `<td style="padding-right:14px"><img src="${escapeHtml(identity.logoUrl)}" height="34" width="34" alt="" style="display:block;object-fit:contain"></td>` : ""}<td><strong style="font-size:17px;line-height:1.4">${name}</strong><br><span style="font-size:12px;line-height:1.7;color:#797b73">${escapeHtml(host)}</span></td></tr></table></a></td></tr><tr><td class="inner" style="padding:32px 36px 18px;background:#f7f7f3"><h1 class="title" style="font-size:34px;line-height:1.18;letter-spacing:-.7px;color:#202822;margin:0 0 20px">${escapeHtml(title)}</h1>${detail ? `<p style="font-size:13px;color:#797b73;margin:0 0 6px"><strong style="color:#424c45">${escapeHtml(detail.dateRange)}</strong> &nbsp; / &nbsp; ${detail.publicationCount} ${detail.publicationCount === 1 ? "publication" : "publications"}</p>` : ""}</td></tr><tr><td class="inner" style="padding:28px 36px 36px">${content}</td></tr><tr><td class="inner" style="padding:24px 36px;background:#f7f7f3;border-top:1px solid #eceee7"><p style="font-size:13px;font-weight:700;color:#424c45;margin:0 0 8px">${name}</p><p style="font-size:12px;line-height:1.8;color:#797b73;margin:0">${footerHtml}</p></td></tr></table><p style="max-width:640px;margin:18px auto 0;text-align:center;font-size:11px;color:#8a8c85">Sent by ${name} through OpenScholar</p></td></tr></table></body></html>`;
}

export function renderLibraryInvitation({
	identity,
	role,
	acceptUrl,
}: {
	identity: LibraryEmailIdentity;
	role: "editor" | "creator";
	acceptUrl: string;
}) {
	const description =
		role === "editor"
			? "Create and edit items, review submissions and publish approved work."
			: "Create and edit items, upload files and submit work for review.";
	return renderLibraryEmail({
		identity,
		title: "You’re invited to join the library",
		content: `<p style="${emailStyles.paragraph}">You’ve been invited to contribute to <strong style="color:#202822">${escapeHtml(identity.name)}</strong>.</p>${emailPanel(role === "editor" ? "Editor" : "Creator", description, "Your library role")}${emailButton("Accept invitation", acceptUrl, identity.accent)}<p style="font-size:13px;line-height:1.7;color:#797b73;margin:22px 0 0">Sign in with the email address that received this invitation. Your invitation expires in 7 days.</p>`,
		footerHtml:
			"You received this email because you were invited to the library.",
	});
}
