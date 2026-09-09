import { OrganizationFeatureGate } from "@/components/auth/organization-feature-gate";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ExtractionAccessGate } from "@/components/extraction/extraction-access-gate";

export async function generateMetadata(): Promise<Metadata> {
  const [t, tc, te] = await Promise.all([
    getTranslations("metadata"),
    getTranslations("common"),
    getTranslations("extraction"),
  ]);

  return {
    title: {
      default: tc("extraction"),
      template: `%s | ${t("siteName")}`,
    },
    description: te("extractDescription"),
  };
}

export default function ExtractionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <OrganizationFeatureGate feature="extraction"><ExtractionAccessGate>{children}</ExtractionAccessGate></OrganizationFeatureGate>;
}
