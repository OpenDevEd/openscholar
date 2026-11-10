import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { MarkdownContent } from "@/components/markdown-content";
import { PageWrapper } from "@/components/PageWrapper";
import { isAdmin, organizationsOf } from "@/lib/publish-mock/admin";
import { mayWorkOn } from "@/lib/publish-mock/types";
import { fillAgreement } from "@/lib/publish-mock/agreement";
import { readState } from "@/lib/publish-mock/store";

export const metadata: Metadata = { title: "Publishing agreement", robots: { index: false, follow: false } };

const day = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

// MOCK (mock/publish-reports): the agreement a report's author signed, in the wording of the version they signed,
// with who signed and when. Its workspace and Openscholar's admins read it; it can be saved or printed from here.
export default async function SignedAgreementPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, { userId }, state] = await Promise.all([params, auth(), readState()]);
  const report = state.submissions.find((s) => s.id === id && s.signedAt && s.signedBy);
  if (!report || !userId || !(mayWorkOn(report, userId, report.orgId ? await organizationsOf(userId) : []) || (await isAdmin()))) notFound();
  const version = report.agreementVersion ?? state.settings.agreement.version;
  // An older version's wording is kept when the text changes; the current one is the settings' own.
  const text = state.agreementVersions?.[String(version)] ?? state.settings.agreement.text;
  const m = report.metadata;
  return (
    <PageWrapper>
      <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <MarkdownContent
          content={fillAgreement(text, { name: report.signedBy!.name, date: new Date(report.signedAt!), doi: report.doi, title: m?.title, authors: m?.authors.map((a) => a.name).filter(Boolean), pages: report.pdf?.pages })}
          className="text-sm [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:leading-snug [&_h2]:text-base"
        />
        <dl className="mt-10 grid gap-x-8 gap-y-3 rounded-2xl border border-border-subtle bg-inset/60 p-5 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Signed by</dt>
            <dd className="font-medium">{report.signedBy!.name}</dd>
            {report.signedBy!.onBehalfOfAll ? <dd className="text-xs text-muted-foreground">For all the authors, who have agreed</dd> : null}
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Signed on</dt>
            <dd className="font-medium">{day(report.signedAt!)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Agreement</dt>
            <dd className="font-medium">Version {version}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Report</dt>
            <dd className="truncate font-mono text-xs">{report.id}, doi.org/{report.doi}</dd>
          </div>
        </dl>
      </article>
    </PageWrapper>
  );
}
