/** A page's path without its organization's prefix (/o/<slug>, #651): the page each section reads itself as. */
export const bareWorkspacePath = (pathname: string) => pathname.replace(/^\/o\/[^/]+(?=\/|$)/, "") || "/";
