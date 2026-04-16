import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SelectorPageClient } from "./selector-page-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("extraction.selector");
  return {
    title: t("title"),
  };
}

export default function ExtractionNewPage() {
  return <SelectorPageClient />;
}
