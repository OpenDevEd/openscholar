import { auth } from "@clerk/nextjs/server";
import { fetchAction, fetchMutation, fetchQuery } from "convex/nextjs";
import { FromLibrary } from "@/components/evidence-libraries/from-library";
import { api } from "@/convex/_generated/api";

// Where an Evidence Library's "Open in OpenScholar" lands (plans/evidence-library-sources): the hand-off read on the
// server as the person opening it, in their own workspace or an organization's under /o/<slug>, so it's there from
// the first frame.
export default async function FromLibraryPage({ params }: { params: Promise<{ id: string; slug?: string }> }) {
  const { id, slug } = await params;
  const token = (await (await auth()).getToken({ template: "convex" })) ?? undefined;
  const own = async () => {
    // Someone who just made their account from the library's link has no workspace until the app first sets it up.
    const found = await fetchQuery(api.workspaces.queries.personal, {}, { token });
    if (found) return found;
    await fetchMutation(api.users.mutations.ensureUser, {}, { token });
    return await fetchQuery(api.workspaces.queries.personal, {}, { token });
  };
  const workspaceId = token ? await (slug ? fetchQuery(api.workspaces.queries.bySlug, { slug }, { token }) : own()) : null;
  const opened = workspaceId ? await fetchAction(api.evidenceLibraries.handoffs.open, { workspaceId, handoffId: id, records: true }, { token }) : ({ gone: true } as const);
  return <FromLibrary handoffId={id} workspaceId={workspaceId} opened={opened} />;
}
