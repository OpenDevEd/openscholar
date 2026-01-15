import { Metadata } from "next";
import { HistoryPageClient } from "./history-page-client";

export const metadata: Metadata = {
  title: "Search History | OpenScholar",
  description: "View and manage your past search queries.",
};

export default function HistoryPage() {
  return <HistoryPageClient />;
}
