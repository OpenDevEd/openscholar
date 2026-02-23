import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { PolicyPage } from "@/components/policy-page";
import { getLegalMarkdown } from "@/lib/legal-content";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");

  return {
    title: t("cookiePolicyTitle"),
    description: t("cookiePolicyDescription"),
  };
}

export default async function CookiePolicyPage() {
  const [locale, t] = await Promise.all([
    getLocale(),
    getTranslations("legal"),
  ]);

  const markdownContent = await getLegalMarkdown({
    docType: "cookie",
    locale,
  });

  return (
    <PolicyPage
      content={markdownContent}
      otherPolicyLink={{ href: "/privacy", label: t("privacyPolicy") }}
    />
  );
}
