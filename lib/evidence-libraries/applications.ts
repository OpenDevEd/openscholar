/** Applications to join a community one read of its Team card's Applications tab shows, oldest first, on the server and in the browser alike. */
export const APPLICATIONS_PAGE = 20;
/** The person's applications the Communities sidebar's first page lists, newest first, above their communities. */
export const APPLICATIONS_SHOWN = 20;
/** The Communities page's address parameter that holds the dialog to apply open, on the community it names. */
export const APPLY_PARAM = "apply";
/** Where someone signed out goes to apply: sign-in, which comes back to the Communities page with the dialog open. */
export const applySignInPath = (libraryId: string) => `/sign-in?redirect_url=${encodeURIComponent(`/evidence-communities?${APPLY_PARAM}=${libraryId}`)}`;
/** Where someone signed out goes to see the papers they sent: sign-in, which comes back to their submissions. */
export const SUBMISSIONS_SIGN_IN_PATH = `/sign-in?redirect_url=${encodeURIComponent("/evidence-communities?view=submissions")}`;
