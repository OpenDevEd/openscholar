"use client";

// The agreement a report's author signed, in the wording of the version they signed, with who signed and when. Its
// workspace reads it; it can be saved or printed from here.

import { useFormatter, useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import { PageFrameLoading } from "@/components/evidence-libraries/library-page-shell";
import { ListEmpty } from "@/components/evidence-libraries/list-controls";
import { MarkdownContent } from "@/components/markdown-content";
import { PageWrapper } from "@/components/PageWrapper";
import { FileText } from "@/components/icons";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { fillAgreement } from "@/lib/reports/agreement";
import { inWorkspace, useWorkspace } from "@/lib/workspaces/url";

export function SignedAgreement({ reportKey }: { reportKey: string }) {
  const t = useTranslations("publishReports.signedAgreement");
  const format = useFormatter();
  const { data: mine, isAnonymous } = useProtectedQuery(api.reports.flow.agreement, inWorkspace(useWorkspace(), { key: reportKey }));
  // A reviewer reads any report's agreement; everyone else, their workspace's.
  const { data: admin } = useProtectedQuery(api.admins.queries.amI, {});
  const { data: reviewed } = useProtectedQuery(api.reports.review.agreement, admin ? { key: reportKey } : "skip");
  const signed = mine ?? reviewed;
  if (!isAnonymous && (mine === undefined || admin === undefined || (admin && reviewed === undefined))) return <PageFrameLoading label={t("loading")} />;
  if (!signed) {
    return (
      <PageWrapper>
        <ListEmpty icon={FileText} description={t("missingBody")}>
          {t("missingTitle")}
        </ListEmpty>
      </PageWrapper>
    );
  }
  return (
    <PageWrapper>
      <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div lang="en" dir="ltr">
          <MarkdownContent content={fillAgreement(signed.text, { name: signed.signer, date: new Date(signed.signedAt), byline: signed.byline, doi: signed.doi, title: signed.title, authors: signed.authors, pages: signed.pages })} className="text-sm [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:leading-snug [&_h2]:text-base" />
        </div>
        <dl className="mt-10 grid grid-cols-1 gap-x-8 gap-y-3 rounded-2xl border border-border-subtle bg-inset/60 p-5 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">{t("signedBy")}</dt>
            <dd className="font-medium">{signed.signer}</dd>
            {signed.onBehalfOfAll ? <dd className="text-xs text-muted-foreground">{t("forAll")}</dd> : null}
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("signedOn")}</dt>
            <dd className="font-medium">{format.dateTime(signed.signedAt, { day: "numeric", month: "long", year: "numeric" })}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("agreement")}</dt>
            <dd className="font-medium">{t("version", { version: signed.version })}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("report")}</dt>
            <dd className="truncate font-mono text-xs">
              {reportKey}, doi.org/{signed.doi}
            </dd>
          </div>
        </dl>
      </article>
    </PageWrapper>
  );
}
