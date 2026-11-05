import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { PolicyPage } from "@/components/policy-page";
import { getLegalMarkdown } from "@/lib/legal-content";
import { indexedPage } from "@/lib/seo/page-metadata";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");

  return indexedPage({ path: "/terms", title: `${t("termsTitle")} | ${t("siteName")}`, description: t("termsDescription") });
}

export default async function TermsPage() {
  const [locale, t] = await Promise.all([
    getLocale(),
    getTranslations("legal"),
  ]);

  const markdownContent = await getLegalMarkdown({
    docType: "terms",
    locale,
  });

  return (
    <PolicyPage
      content={markdownContent}
      otherPolicyLink={{ href: "/privacy", label: t("privacyPolicy") }}
    />
  );
}
