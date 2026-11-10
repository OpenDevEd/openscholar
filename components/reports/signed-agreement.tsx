"use client";

// The agreement a report's author signed, in the wording of the version they signed, with who signed and when. Its
// workspace reads it; it can be saved or printed from here.

import { api } from "@/convex/_generated/api";
import { PageFrameLoading } from "@/components/evidence-libraries/library-page-shell";
import { ListEmpty } from "@/components/evidence-libraries/list-controls";
import { MarkdownContent } from "@/components/markdown-content";
import { PageWrapper } from "@/components/PageWrapper";
import { FileText } from "@/components/icons";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { fillAgreement } from "@/lib/reports/agreement";
import { inWorkspace, useWorkspace } from "@/lib/workspaces/url";

const day = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

export function SignedAgreement({ reportKey }: { reportKey: string }) {
  const { data: mine, isAnonymous } = useProtectedQuery(api.reports.flow.agreement, inWorkspace(useWorkspace(), { key: reportKey }));
  // A reviewer reads any report's agreement; everyone else, their workspace's.
  const { data: admin } = useProtectedQuery(api.admins.queries.amI, {});
  const { data: reviewed } = useProtectedQuery(api.reports.review.agreement, admin ? { key: reportKey } : "skip");
  const signed = mine ?? reviewed;
  if (!isAnonymous && (mine === undefined || admin === undefined || (admin && reviewed === undefined))) return <PageFrameLoading label="Publishing agreement" />;
  if (!signed) {
    return (
      <PageWrapper>
        <ListEmpty icon={FileText} description="It isn't one of this workspace's reports, or it was discarded. Sign in with the account it was published from.">
          This agreement isn&apos;t here
        </ListEmpty>
      </PageWrapper>
    );
  }
  return (
    <PageWrapper>
      <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <MarkdownContent content={fillAgreement(signed.text, { name: signed.signer, date: new Date(signed.signedAt), doi: signed.doi, title: signed.title, authors: signed.authors, pages: signed.pages })} className="text-sm [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:leading-snug [&_h2]:text-base" />
        <dl className="mt-10 grid gap-x-8 gap-y-3 rounded-2xl border border-border-subtle bg-inset/60 p-5 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Signed by</dt>
            <dd className="font-medium">{signed.signer}</dd>
            {signed.onBehalfOfAll ? <dd className="text-xs text-muted-foreground">For all the authors, who have agreed</dd> : null}
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Signed on</dt>
            <dd className="font-medium">{day(signed.signedAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Agreement</dt>
            <dd className="font-medium">Version {signed.version}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Report</dt>
            <dd className="truncate font-mono text-xs">
              {reportKey}, doi.org/{signed.doi}
            </dd>
          </div>
        </dl>
      </article>
    </PageWrapper>
  );
}
