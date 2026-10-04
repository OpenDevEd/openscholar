import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { PolicyPage } from "@/components/policy-page";
import { getLegalMarkdown } from "@/lib/legal-content";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");

  return {
    title: t("creditsTitle"),
    description: t("creditsDescription"),
  };
}

export default async function CreditsPage() {
  const [locale, t] = await Promise.all([
    getLocale(),
    getTranslations("legal"),
  ]);

  const markdownContent = await getLegalMarkdown({
    docType: "credits",
    locale,
  });

  return (
    <PolicyPage
      content={markdownContent}
      otherPolicyLink={{ href: "/privacy", label: t("privacyPolicy") }}
    />
  );
}
