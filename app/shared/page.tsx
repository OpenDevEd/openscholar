import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { getTranslations } from "next-intl/server";
import { PageWrapper } from "@/components/PageWrapper";
import { SharedWithMe } from "@/components/workspaces/shared";
import { api } from "@/convex/_generated/api";
import { SHARED_PAGE } from "@/lib/sharing";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("sharedTitle") };
}

// What people outside your workspaces shared with you (#653). It has no page under /o/<slug>:
// a shared item is in your own workspace. The list arrives with the page, so it's there from the
// first frame.
export default async function SharedPage() {
  const token = (await (await auth()).getToken({ template: "convex" })) ?? undefined;
  const workspaceId = token ? await fetchQuery(api.workspaces.queries.personal, {}, { token }) : null;
  const initial = workspaceId
    ? await Promise.all([
        fetchQuery(api.sharing.shared.counts, { workspaceId }, { token }),
        fetchQuery(api.sharing.shared.list, { workspaceId, sort: "recent", paginationOpts: { cursor: null, numItems: SHARED_PAGE } }, { token }),
      ]).then(([counts, first]) => ({ counts, rows: first.page }))
    : undefined;
  return (
    <PageWrapper>
      <SharedWithMe initial={initial} />
    </PageWrapper>
  );
}
