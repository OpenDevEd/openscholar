import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ExtractionAccessGate } from "@/components/extraction/extraction-access-gate";

export async function generateMetadata(): Promise<Metadata> {
  const [tc, te] = await Promise.all([getTranslations("common"), getTranslations("extraction")]);
  return { title: tc("extraction"), description: te("extractDescription") };
}

export default function ExtractionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ExtractionAccessGate>{children}</ExtractionAccessGate>;
}
