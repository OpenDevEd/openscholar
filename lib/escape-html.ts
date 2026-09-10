// Generated from OpenDevEd/new-el src/lib/escape-html.ts.
// Regenerate with: node scripts/sync-library-email-template.mjs <new-el checkout>
/** Escapes text for safe insertion into HTML. */
export function escapeHtml(value: string) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}
