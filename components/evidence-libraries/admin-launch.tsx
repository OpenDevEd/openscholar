"use client";

import { useOrganization } from "@clerk/nextjs";
import { useAction } from "convex/react";
import { ExternalLink, Settings } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { openAdminLaunchUrl } from "@/lib/evidence-libraries/open-admin-launch";
import { FieldGroup, MetaList, PanelRow } from "./configuration/fields";
import { InlineNotice } from "./configuration/section-card";
import { LibraryNotFound } from "./library-not-found";
import { LibraryPageShell } from "./library-page-shell";
import { LibraryStatusChip } from "./library-status-chip";

export function AdminLaunch({ libraryId }: { libraryId: string }) {
  const t = useTranslations("evidenceLibraries.admin");
  const { membership } = useOrganization();
  const launchState = useProtectedQuery(
    api.evidenceLibraries.queries.getAdminLaunchState,
    { libraryId },
  );
  const issueAdminLoginCode = useAction(
    api.evidenceLibraries.adminLoginCodeActions.issueAdminLoginCode,
  );
  const [creatingCode, setCreatingCode] = useState(false);

  if (launchState.data === undefined) {
    return <AuthStatePanel variant="loading" loadingStyle="spinner" />;
  }
  if (launchState.data === null) return <LibraryNotFound />;

  const library = launchState.data;
  const isOwner = membership?.role === "org:admin";
  const base = `/evidence-libraries/${library.libraryId}`;
  const adminAddress = `${library.publicAddress}/admin`;
  const ready = library.status === "ready";

  function openAdmin() {
    if (creatingCode || !ready) return;
    setCreatingCode(true);
    void issueAdminLoginCode({ libraryId: library.libraryId })
      .then(({ launchUrl }) => openAdminLaunchUrl(launchUrl))
      .catch(() => {
        toast.error(t("openError"));
        setCreatingCode(false);
      });
  }

  return (
    <LibraryPageShell
      title={library.libraryName}
      eyebrow={library.publicAddress}
      backHref="/evidence-libraries"
      backLabel={t("backToLibraries")}
      titleAside={<LibraryStatusChip status={library.libraryStatus} />}
      actions={
        isOwner ? (
          <Button asChild variant="outline">
            <Link href={`${base}/configuration`}>
              <Settings />
              {t("configure")}
            </Link>
          </Button>
        ) : null
      }
    >
      <div className="p-4 md:p-6" data-admin-state={ready ? "ready" : "not-ready"}>
        <FieldGroup title={t("title")} hint={t("description")}>
          <div className="space-y-4">
            <MetaList
              items={[
                {
                  key: "admin",
                  label: t("adminAddress"),
                  value: <span className="font-mono">{adminAddress}</span>,
                },
                {
                  key: "version",
                  label: t("version"),
                  value: (
                    <span className="font-mono">{library.activeRevisionKey ?? t("noneYet")}</span>
                  ),
                },
              ]}
            />
            <PanelRow title={isOwner ? t("ownerTitle") : t("editorTitle")} hint={t("roleHint")} />
            {ready ? (
              <div>
                <Button onClick={openAdmin} disabled={creatingCode}>
                  {creatingCode ? <Spinner /> : <ExternalLink />}
                  {creatingCode ? t("creatingCode") : t("openAdmin")}
                </Button>
              </div>
            ) : (
              <InlineNotice
                tone="warning"
                action={
                  isOwner ? (
                    <Button asChild size="sm" variant="outline" className="h-7">
                      <Link href={`${base}/setup`}>{t("viewSetup")}</Link>
                    </Button>
                  ) : null
                }
              >
                {t("notReadyHint")}
              </InlineNotice>
            )}
          </div>
        </FieldGroup>
      </div>
    </LibraryPageShell>
  );
}
