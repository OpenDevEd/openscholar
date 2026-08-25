"use client";

import { ExternalLink, KeyRound, Play, Rocket, Settings, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { CommandCenterContainer } from "@/components/command-center/command-center-container";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  selectLibrary,
  useEvidenceLibraryMockStore,
} from "@/lib/evidence-libraries/mock/store";
import { LibraryNotFound } from "./library-not-found";
import { LibraryStatusBadge, StatusChip } from "./library-status-badge";
import { PanelHeader } from "./panel-header";
import { PrototypeBadge } from "./prototype-badge";
import { InlineNotice, SectionCard } from "./section-card";
import { AdminSitePreview } from "./site-preview";

const CODE_DELAY_MS = 1000;

export function AdminLaunch({ libraryId }: { libraryId: string }) {
  const t = useTranslations("evidenceLibraryMock.admin");
  const tm = useTranslations("evidenceLibraryMock");
  const library = useEvidenceLibraryMockStore(selectLibrary(libraryId));
  const [creatingCode, setCreatingCode] = useState(false);
  const [tabOpen, setTabOpen] = useState(false);

  if (!library) return <LibraryNotFound />;

  const base = `/evidence-libraries/${library.id}`;
  const ready = library.status === "active";

  function openAdmin() {
    if (creatingCode) return;
    setCreatingCode(true);
    // Fake the one-time-code round trip.
    setTimeout(() => {
      setCreatingCode(false);
      setTabOpen(true);
      toast.success(t("signedIn"), { description: t("signedInDescription") });
    }, CODE_DELAY_MS);
  }

  return (
    <div className="container mx-auto max-w-6xl p-4 sm:p-6">
      <div className="mb-4 flex justify-end">
        <PrototypeBadge />
      </div>
      <CommandCenterContainer>
        <PanelHeader
          icon={KeyRound}
          title={t("title")}
          description={t("description", { name: library.name })}
        >
          <LibraryStatusBadge library={library} />
        </PanelHeader>

        <div className="max-w-2xl space-y-4 p-4 md:p-6">
          <div className="rounded-xl border border-border/50 bg-muted/30 p-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t("publicAddress")}</dt>
              <dd>
                <a
                  className="font-mono text-sm hover:underline"
                  href={`https://${library.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {library.address}
                </a>
              </dd>
              <dt className="text-muted-foreground">{t("adminAddress")}</dt>
              <dd className="font-mono text-sm">https://{library.address}/admin</dd>
              <dt className="text-muted-foreground">{t("activeRevision")}</dt>
              <dd>
                {library.activeRev ? (
                  <StatusChip tone="success" className="font-mono normal-case tracking-normal">
                    {library.activeRev}
                  </StatusChip>
                ) : (
                  <span className="text-muted-foreground">{t("noneYet")}</span>
                )}
              </dd>
              <dt className="text-muted-foreground">{t("yourRole")}</dt>
              <dd>
                {tm("roleOwner")}{" "}
                <code className="text-xs font-mono text-muted-foreground">org:admin</code>
              </dd>
            </dl>
          </div>

          {ready ? (
            <SectionCard icon={KeyRound} title={t("signInTitle")} data-admin-state="ready">
              <div className="flex items-start gap-3 rounded-lg border border-border/50 bg-background p-3 text-sm text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <span>{t("codeExplain")}</span>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button asChild variant="outline">
                  <Link href={`${base}/configuration`}>
                    <Settings />
                    {t("configure")}
                  </Link>
                </Button>
                <Button onClick={openAdmin} disabled={creatingCode}>
                  {creatingCode ? <Spinner /> : <ExternalLink />}
                  {creatingCode ? t("creatingCode") : t("openAdmin")}
                </Button>
              </div>
            </SectionCard>
          ) : (
            <div className="space-y-4" data-admin-state="not-ready">
              <InlineNotice tone="warning" title={t("notReadyTitle")}>
                {t("notReadyHint")}
              </InlineNotice>
              <div className="flex justify-end">
                {library.status === "draft" ? (
                  <Button asChild>
                    <Link href={`${base}/configuration`}>
                      <Play />
                      {t("continueSetup")}
                    </Link>
                  </Button>
                ) : (
                  <Button asChild>
                    <Link href={`${base}/setup`}>
                      <Rocket />
                      {t("viewSetup")}
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </CommandCenterContainer>

      <Dialog open={tabOpen} onOpenChange={setTabOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ExternalLink className="size-4" />
              {t("newTab")}
              <PrototypeBadge variant="mock" />
            </DialogTitle>
            <DialogDescription>{t("newTabMock")}</DialogDescription>
          </DialogHeader>
          <AdminSitePreview
            config={library.saved}
            address={library.address}
            activeRev={library.activeRev}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
