import type { Metadata } from "next";
import { currentUser } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { PublishFlow } from "@/components/publish-mock/publish-flow";
import { organizationsOf } from "@/lib/publish-mock/admin";
import { readState } from "@/lib/publish-mock/store";
import { canPublish, limitFor, startsLeft } from "@/lib/publish-mock/types";

export const metadata: Metadata = { title: "Publish | Openscholar" };

// MOCK (mock/publish-reports): the report being published comes from the mock's local store, so it's there from the first frame.
export default async function PublishPage({ searchParams }: { searchParams: Promise<{ correct?: string }> }) {
  const [state, user, { correct }] = await Promise.all([readState(), currentUser(), searchParams]);
  if (!canPublish(state.settings)) notFound();
  // A link from a live report's own page opens that report here with its details ready to correct. Only its author's.
  const correcting = (user && state.submissions.find((s) => s.id === correct && s.status === "live" && (s.demo || s.ownerId === user.id))) || null;
  const draft = correcting ?? ((user && state.submissions.find((s) => s.id === state.drafts[user.id])) || null);
  // Yours: the reports you started, and the mock's samples. Newest first.
  const reports = state.submissions.filter((s) => s.demo || (user && s.ownerId === user.id)).sort((a, b) => b.updatedAt - a.updatedAt);
  // Asked of Clerk only when some organisation has a limit of its own.
  const orgIds = user && state.settings.limits.overrides.some((o) => o.kind === "organization") ? await organizationsOf(user.id) : [];
  const starts = user ? { left: startsLeft(state, user.id, orgIds), perDay: limitFor(state.settings, user.id, orgIds) } : { left: 1, perDay: 1 };
  return <PublishFlow settings={state.settings} initial={draft} reports={reports} userName={user?.fullName ?? ""} signedIn={!!user} starts={starts} />;
}
