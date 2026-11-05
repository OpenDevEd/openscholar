import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { PolicyPage } from "@/components/policy-page";
import { getLegalMarkdown } from "@/lib/legal-content";
import { indexedPage } from "@/lib/seo/page-metadata";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");

  return indexedPage({ path: "/privacy", title: `${t("privacyTitle")} | ${t("siteName")}`, description: t("privacyDescription") });
}

export default async function PrivacyPage() {
  const [locale, t] = await Promise.all([
    getLocale(),
    getTranslations("legal"),
  ]);

  const markdownContent = await getLegalMarkdown({
    docType: "privacy",
    locale,
  });

  return (
    <PolicyPage
      content={markdownContent}
      otherPolicyLink={{ href: "/cookie-policy", label: t("cookiePolicy") }}
    />
  );
}
