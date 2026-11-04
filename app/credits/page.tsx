import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { PolicyPage } from "@/components/policy-page";
import { getLegalMarkdown } from "@/lib/legal-content";
import { indexedPage } from "@/lib/seo/page-metadata";
import { activeSearchSource } from "@/lib/search/active-source";

/** The page without its section on OpenAlex's data, for while our own index is what people search. */
const withoutOpenAlexData = (markdown: string) => markdown.replace(/^## [^\n]*\n+[^\n]*openalex\.org[^\n]*\n+/m, "");

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");

  return indexedPage({ path: "/credits", title: `${t("creditsTitle")} | ${t("siteName")}`, description: t("creditsDescription") });
}

export default async function CreditsPage() {
  const [locale, t, source] = await Promise.all([
    getLocale(),
    getTranslations("legal"),
    activeSearchSource(),
  ]);

  const markdownContent = await getLegalMarkdown({
    docType: "credits",
    locale,
  });

  return (
    <PolicyPage
      content={source === "openalex" ? markdownContent : withoutOpenAlexData(markdownContent)}
      otherPolicyLink={{ href: "/privacy", label: t("privacyPolicy") }}
    />
  );
}
