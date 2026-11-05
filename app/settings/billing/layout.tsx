import type { Metadata } from "next";
import type { ReactNode } from "react";
import { auth } from "@clerk/nextjs/server";
import { fetchAction, fetchQuery } from "convex/nextjs";
import { getTranslations } from "next-intl/server";
import { api } from "@/convex/_generated/api";
import { namedTitle } from "@/lib/seo/page-metadata";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("workspaces");
  return { title: await namedTitle(t("planAndCredits")) };
}

/**
 * Re-reads the workspace's account from Autumn as the billing page opens, so edits
 * made in Autumn's dashboard that send no webhook (a balance grant, say) show.
 * The page still renders if Autumn is slow or down; it shows the cached copy.
 * An organization's billing page (`/o/<slug>/settings/billing`) uses this layout too.
 */
export default async function BillingLayout({ children, params }: { children: ReactNode; params: Promise<{ slug?: string }> }) {
  const token = (await (await auth()).getToken({ template: "convex" })) ?? undefined;
  const { slug } = await params;
  if (token) {
    const refresh = async () => {
      const workspaceId = slug ? await fetchQuery(api.workspaces.queries.bySlug, { slug }, { token }) : undefined;
      if (workspaceId !== null) await fetchAction(api.billing.accounts.refreshMine, { workspaceId }, { token });
    };
    await refresh().catch((error) => {
      console.error("[billing] couldn't refresh the account from Autumn", error);
    });
  }
  return children;
}
