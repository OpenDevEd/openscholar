import type { Metadata } from "next";
import { auth, currentUser } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { PublishFlow } from "@/components/publish-mock/publish-flow";
import { readState } from "@/lib/publish-mock/store";
import { canPublish, limitFor, startsLeft } from "@/lib/publish-mock/types";

export const metadata: Metadata = { title: "Publish | Openscholar" };

// MOCK (mock/publish-reports): the report being published comes from the mock's local store, so it's there from the first frame.
export default async function PublishPage() {
  const [state, user] = await Promise.all([readState(), currentUser()]);
  if (!canPublish(state.settings)) notFound();
  const draft = (user && state.submissions.find((s) => s.id === state.drafts[user.id])) || null;
  // Yours: the reports you started, and the mock's samples. Newest first.
  const reports = state.submissions.filter((s) => s.demo || (user && s.ownerId === user.id)).sort((a, b) => b.updatedAt - a.updatedAt);
  const { orgId } = await auth();
  const starts = user ? { left: startsLeft(state, user.id, orgId), perDay: limitFor(state.settings, user.id, orgId) } : { left: 1, perDay: 1 };
  return <PublishFlow settings={state.settings} initial={draft} reports={reports} userName={user?.fullName ?? ""} signedIn={!!user} starts={starts} />;
}
