import type { Metadata } from "next";
import { auth, currentUser } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { PublishFlow } from "@/components/publish-mock/publish-flow";
import { organizationsOf } from "@/lib/publish-mock/admin";
import { readState } from "@/lib/publish-mock/store";
import { authorSettings, canPublish, limitFor, reportsUnderWay, startsLeft } from "@/lib/publish-mock/types";

export const metadata: Metadata = { title: "Publish | Openscholar" };

// MOCK (mock/publish-reports): the reports come from the mock's local store, so the page is whole from its first frame.
// Which report it shows is in the address (`report`), so a link from an email, a reload and the back button all land
// on the same report at the step it has reached.
export default async function PublishPage({ searchParams }: { searchParams: Promise<{ report?: string; view?: string }> }) {
  const [state, user, { report, view }] = await Promise.all([readState(), currentUser(), searchParams]);
  // Publishing switched off stops new reports. One already started keeps its address, so an email's link, its own
  // page's button and Your reports still open it.
  if (!canPublish(state.settings) && (!report || report === "new") && view !== "reports") notFound();
  // A link to a report is its author's to open: signing in comes back to it.
  if (!user && report && report !== "new") return (await auth()).redirectToSignIn({ returnBackUrl: `/publish?report=${encodeURIComponent(report)}` });
  // Yours: the reports you started, and the mock's samples. Newest first.
  const reports = state.submissions.filter((s) => s.demo || (user && s.ownerId === user.id)).sort((a, b) => b.updatedAt - a.updatedAt);
  // Publish with no report named carries on with the one under way, at its own address. With several under way it
  // opens the list to pick from; with none, a new report.
  const underWay = !report && view !== "reports" ? reportsUnderWay(reports) : [];
  if (underWay.length === 1) redirect(`/publish?report=${underWay[0]!.id}`);
  if (underWay.length > 1) redirect("/publish?view=reports");
  // Asked of Clerk only when some organisation has a limit of its own.
  const orgIds = user && state.settings.limits.overrides.some((o) => o.kind === "organization") ? await organizationsOf(user.id) : [];
  const starts = user ? { left: startsLeft(state, user.id, orgIds), perDay: limitFor(state.settings, user.id, orgIds) } : { left: 1, perDay: 1 };
  return <PublishFlow settings={authorSettings(state.settings)} reports={reports} userName={user?.fullName ?? ""} signedIn={!!user} starts={starts} />;
}
