import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { auth } from "@clerk/nextjs/server";
import { fetchAction, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { PublishFlow } from "@/components/reports/publish-flow";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("publishReports.meta");
  return { title: t("publish") };
}

/**
 * Publish to Openscholar Reports (plans/publish-reports). It is a workspace's section, like the library: under
 * /o/<slug> it shows that organisation's reports, and outside it the person's own. Which report it shows is in the
 * address (`report`), so a link from an email, a reload and the back button all land on the same report.
 *
 * Opening a report settles its workspace's payments first (#1261): an activation whose charge the bank has since
 * confirmed goes live, and when Stripe sent the person back (`back`), the workspace's card is read again, the one saved in the Checkout session named (`session`) becoming the one charged. The page still
 * renders if Autumn is slow or down; the webhooks catch up.
 */
export default async function PublishPage({ params, searchParams }: { params: Promise<{ slug?: string }>; searchParams: Promise<{ report?: string; back?: string; session?: string; code?: string }> }) {
  const [{ slug }, { report, back, session, code }] = await Promise.all([params, searchParams]);
  // A code applied before leaving for Stripe's page comes back in the address: it is quoted here, so the report opens
  // with it applied and nobody types or applies it a second time. A code that no longer quotes stays typed in its field.
  let carried: { key: string; code: string; price: number; discount: number; total: number } | null = null;
  if (report || back) {
    const token = (await (await auth()).getToken({ template: "convex" })) ?? undefined;
    if (token) {
      const settle = async () => {
        const workspaceId = slug ? await fetchQuery(api.workspaces.queries.bySlug, { slug }, { token }) : await fetchQuery(api.workspaces.queries.personal, {}, { token });
        if (!workspaceId) return;
        await fetchAction(api.reports.activation.settle, { workspaceId, card: back !== undefined, ...(session && { session }) }, { token });
        if (report && code?.trim()) {
          carried = await fetchAction(api.reports.activation.quote, { workspaceId, key: report, code }, { token }).then(
            (quote) => ({ key: report, code: code.trim(), ...quote }),
            () => null,
          );
        }
      };
      await settle().catch((error) => {
        console.error("[publish] couldn't settle the workspace's payments", error);
      });
    }
  }
  return <PublishFlow carried={carried} />;
}
