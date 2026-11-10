import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SignedAgreement } from "@/components/reports/signed-agreement";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("publishReports.meta");
  return { title: t("agreement"), robots: { index: false, follow: false } };
}

/** The agreement a report's author signed, for its workspace to read, save or print. */
export default async function SignedAgreementPage({ params }: { params: Promise<{ key: string }> }) {
  return <SignedAgreement reportKey={(await params).key} />;
}
