import { Pricing } from "@/components/Pricing";
import { PageWrapper } from "@/components/PageWrapper";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { indexedPage } from "@/lib/seo/page-metadata";

export async function generateMetadata(): Promise<Metadata> {
  const [t, tm] = await Promise.all([getTranslations("pricing"), getTranslations("metadata")]);
  return indexedPage({ path: "/pricing", title: `${t("metadataTitle")} | ${tm("siteName")}`, description: t("metadataDescription") });
}

export default function PricingPage() {
  return (
    <PageWrapper>
      <Pricing />
    </PageWrapper>
  );
}
