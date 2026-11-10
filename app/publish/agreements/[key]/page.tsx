import type { Metadata } from "next";
import { SignedAgreement } from "@/components/reports/signed-agreement";

export const metadata: Metadata = { title: "Publishing agreement", robots: { index: false, follow: false } };

/** The agreement a report's author signed, for its workspace to read, save or print. */
export default async function SignedAgreementPage({ params }: { params: Promise<{ key: string }> }) {
  return <SignedAgreement reportKey={(await params).key} />;
}
