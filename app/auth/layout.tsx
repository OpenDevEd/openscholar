import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  const tc = await getTranslations("common");

  return {
    title: `${tc("signIn")} | ${t("siteName")}`,
    description: t("defaultDescription"),
    robots: { index: false, follow: false },
  };
}

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
