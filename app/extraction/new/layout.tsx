import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { namedTitle } from "@/lib/seo/page-metadata";

export async function generateMetadata(): Promise<Metadata> {
  const [tc, te] = await Promise.all([getTranslations("common"), getTranslations("extraction")]);

  return {
    title: await namedTitle(tc("new")),
    description: te("extractDescription"),
  };
}

export default function NewExtractionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
