import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { HistoryPageClient } from "./history-page-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return {
    title: t("historyTitle"),
    description: t("historyDescription"),
  };
}

export default function HistoryPage() {
  return <HistoryPageClient />;
}
