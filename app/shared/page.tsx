import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageWrapper } from "@/components/PageWrapper";
import { SharedWithMe } from "@/components/workspaces/shared";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("sharedTitle") };
}

// What people outside your workspaces shared with you (#653). It has no page under /o/<slug>:
// a shared item is in your own workspace.
export default function SharedPage() {
  return (
    <PageWrapper>
      <SharedWithMe />
    </PageWrapper>
  );
}
