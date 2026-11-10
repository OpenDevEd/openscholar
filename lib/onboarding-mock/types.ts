// MOCK (mock/onboarding): what a new account's profile setup asks. The real build keeps it on the user's row in Convex.
import type { Affiliation } from "@/lib/publish-mock/types";

/** The emails a person can ask Openscholar for, each with its label and what it brings. */
export const EMAILS = [
  { id: "updates", label: "Product updates", hint: "New features and changes to Openscholar" },
  { id: "news", label: "News and events", hint: "Webinars, community news and research highlights" },
  { id: "research", label: "Research and feedback", hint: "Invitations to try new features and share what you think" },
] as const;
export type EmailKind = (typeof EMAILS)[number]["id"];

/** A person's answers, and whether they finished or skipped the setup; none until they did either. */
export type ProfileSetup = {
  affiliations: Affiliation[];
  orcid: string;
  emails: Record<EmailKind, boolean>;
  finishedAt?: number;
  skippedAt?: number;
};

/** What the person answers, without when they did. */
export type ProfileAnswers = Pick<ProfileSetup, "affiliations" | "orcid" | "emails">;

export const blankSetup = (): ProfileSetup => ({ affiliations: [], orcid: "", emails: { updates: false, news: false, research: false } });

/**
 * Pages in the middle of a flow, which the setup never stands in front of: signing in or up, an app asking to sign
 * in, an invitation, a community's hand-off. It comes on the next page.
 */
const FLOW_PATHS = ["/sign-in", "/sign-up", "/connect", "/join", "/from-library"];
export const inFlow = (pathname: string) => FLOW_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
