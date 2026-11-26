// Where a screening lives in the site: one place for the pages' own links (components/screening/links.ts)
// and for what the server writes into an email or an assistant's reply. Paths in the person's own
// workspace: an organization's prefix goes in front where the page is one of its.

export const SCREENINGS_PATH = "/screening";
/** An open screening's first page, its Overview. */
export const screeningPath = (id: string) => `${SCREENINGS_PATH}/${id}`;
