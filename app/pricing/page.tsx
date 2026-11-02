import { Pricing } from "@/components/Pricing";
import { PageWrapper } from "@/components/PageWrapper";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pricing");
  return { title: t("metadataTitle"), description: t("metadataDescription") };
}

export default function PricingPage() {
  return (
    <PageWrapper>
      <Pricing />
    </PageWrapper>
  );
}
