import type { Metadata } from "next";
import { currentUser } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { PublishFlow } from "@/components/publish-mock/publish-flow";
import { readState } from "@/lib/publish-mock/store";

export const metadata: Metadata = { title: "Publish | Openscholar" };

// MOCK (mock/publish-reports): the report being published comes from the mock's local store, so it's there from the first frame.
export default async function PublishPage() {
  const [state, user] = await Promise.all([readState(), currentUser()]);
  if (!state.settings.enabled) notFound();
  const draft = state.submissions.find((s) => s.id === state.draftId) ?? null;
  return <PublishFlow settings={state.settings} initial={draft} userName={user?.fullName ?? ""} />;
}
