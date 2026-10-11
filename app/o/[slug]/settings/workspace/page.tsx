import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { WorkspaceGeneral } from "@/components/workspaces/settings";
import { api } from "@/convex/_generated/api";

// An organization's General settings. What it shows arrives with the page, as Shared with me's does,
// so the settings card is its full height from the first frame, on a first load and from another tab of Settings.
export default async function WorkspaceGeneralPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const token = (await (await auth()).getToken({ template: "convex" })) ?? undefined;
  // Someone who isn't in it gets no data here: the page then sends them on, as it does today.
  const initial = token
    ? await (async () => {
        const workspaceId = await fetchQuery(api.workspaces.queries.bySlug, { slug }, { token });
        if (!workspaceId) return undefined;
        const [organization, summary] = await Promise.all([fetchQuery(api.organizations.queries.workspace, { workspaceId }, { token }), fetchQuery(api.organizations.queries.summary, { workspaceId }, { token })]);
        return { organization, summary };
      })().catch(() => undefined)
    : undefined;
  return <WorkspaceGeneral initial={initial} />;
}
