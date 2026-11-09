import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  // The rail's own name for the page, in the reader's language.
  const t = await getTranslations("workspaces");
  return { title: t("communities") };
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
