import type { Metadata } from "next";
import { auth, currentUser } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { PublishFlow } from "@/components/publish-mock/publish-flow";
import { actorFor, organizationAt, organizationsOf, slugOf } from "@/lib/publish-mock/admin";
import { readState } from "@/lib/publish-mock/store";
import { authorSettings, canPublish, forAuthor, inWorkspace, limitFor, mayWorkOn, reportsUnderWay, startsLeft } from "@/lib/publish-mock/types";
import { ADDRESS_HEADER, workspaceHref } from "@/lib/workspaces/paths";

export const metadata: Metadata = { title: "Publish | Openscholar" };

// MOCK (mock/publish-reports): the reports come from the mock's local store, so the page is whole from its first frame.
// Publish is a workspace's section, like the library: under /o/<slug> it shows that organisation's reports, which
// every member works on, and outside it the person's own. Which report it shows is in the address (`report`), so a
// link from an email, a reload and the back button all land on the same report at the step it has reached.
export default async function PublishPage({ params, searchParams }: { params: Promise<{ slug?: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [state, user, { slug }, query] = await Promise.all([readState(), currentUser(), params, searchParams]);
  const report = typeof query.report === "string" ? query.report : undefined;
  const view = typeof query.view === "string" ? query.view : undefined;
  // Publishing switched off stops new reports. One already started keeps its address, so an email's link, its own
  // page's button and the list still open it.
  if (!canPublish(state.settings) && (!report || report === "new") && view !== "reports") notFound();
  // A link to a report is its workspace's to open: signing in comes back to it.
  if (!user && report && report !== "new") return (await auth()).redirectToSignIn({ returnBackUrl: (await headers()).get(ADDRESS_HEADER) ?? `/publish?report=${encodeURIComponent(report)}` });
  // The organisation whose workspace this is. Its layout has already turned away anyone who isn't a member.
  const organization = slug ? await organizationAt(slug) : null;
  if (slug && !organization) notFound();
  const here = (path: string) => workspaceHref(slug, path);
  // A report named from the wrong workspace, as by an email or its own page's button, opens in its own.
  const named = report && user ? state.submissions.find((s) => s.id === report) : undefined;
  if (named && user && !inWorkspace(named, user.id, organization?.id) && mayWorkOn(named, user.id, named.orgId ? await organizationsOf(user.id) : [])) {
    const asked = new URLSearchParams(Object.entries(query).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])));
    const its = named.orgId ? await slugOf(named.orgId) : undefined;
    // An organisation that has gone has no address to send anyone to.
    if (!named.orgId || its) redirect(workspaceHref(its, `/publish?${asked}`));
  }
  // The workspace's reports, newest first.
  const reports = state.submissions.filter((s) => user && inWorkspace(s, user.id, organization?.id)).sort((a, b) => b.updatedAt - a.updatedAt);
  // Publish with no report named carries on with the one under way, at its own address. With several under way it
  // opens the list to pick from; with none, a new report.
  const underWay = !report && view !== "reports" ? reportsUnderWay(reports) : [];
  if (underWay.length === 1) redirect(here(`/publish?report=${underWay[0]!.id}`));
  if (underWay.length > 1) redirect(here("/publish?view=reports"));
  // Each workspace has its own limit, and every report started in it counts against it.
  const workspace = user ? ({ kind: organization ? "organization" : "person", id: organization?.id ?? user.id } as const) : null;
  const starts = workspace ? { left: startsLeft(state, workspace), perDay: limitFor(state.settings, workspace) } : { left: 1, perDay: 1 };
  // In an organisation's workspace every member sees its reports; its admins and a report's owner change them.
  const admin = !!organization && !!user && (await actorFor(user.id)).adminOf.includes(organization.id);
  return <PublishFlow settings={authorSettings(state.settings)} reports={reports.map(forAuthor)} userName={user?.fullName ?? ""} signedIn={!!user} starts={starts} shared={!!organization} me={user?.id ?? null} admin={admin} />;
}
