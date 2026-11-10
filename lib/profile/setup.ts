// What a new account's profile setup asks, shared by the setup page, Settings › Profile and the server.
import { bareWorkspacePath } from "@/lib/workspaces/paths";

/** Where the proxy sends a request whose page is a new account's profile setup instead: the address stays the one asked for. */
export const SETUP_PATH = "/profile-setup";
/** The header the proxy puts on such a request, for the root layout to draw the setup alone. */
export const SETUP_HEADER = "x-profile-setup";
/** Holds the account the proxy found done with the setup, so it asks Convex once per account and browser. */
export const SETUP_DONE_COOKIE = "os-profile-setup-done";

/** The emails a person can ask Openscholar for, each with what it brings. */
export const EMAILS = [
  { id: "updates", label: "Product updates", hint: "New features and changes to Openscholar" },
  { id: "news", label: "News and events", hint: "Webinars, community news and research highlights" },
  { id: "research", label: "Research and feedback", hint: "Invitations to try new features and share what you think" },
] as const;
export type EmailKind = (typeof EMAILS)[number]["id"];

export const NO_EMAILS: Record<EmailKind, boolean> = { updates: false, news: false, research: false };

/**
 * Pages in the middle of a flow, which the setup never stands in front of: signing in or up, an app asking someone to
 * sign in, an invitation, a community's hand-off. It comes on the next page.
 */
const FLOW_PATHS = ["/sign-in", "/sign-up", "/connect", "/join", "/from-library"];
export const inFlow = (pathname: string) => {
  // An organisation's pages sit under /o/<slug>, its hand-off among them.
  const bare = bareWorkspacePath(pathname);
  return FLOW_PATHS.some((path) => bare === path || bare.startsWith(`${path}/`));
};
