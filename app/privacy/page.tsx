import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { PolicyPage } from "@/components/policy-page";
import { getLegalMarkdown } from "@/lib/legal-content";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");

  return {
    title: t("privacyTitle"),
    description: t("privacyDescription"),
  };
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
