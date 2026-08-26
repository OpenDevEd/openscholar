"use client";

import { ExternalLink, Layers, Settings } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { CommandCenterContainer } from "@/components/command-center/command-center-container";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { selectLibrary, useEvidenceLibraryMockStore } from "@/lib/evidence-libraries/mock/store";
import { FieldGroup, MetaList, PanelRow } from "./config/fields";
import { LibraryNotFound } from "./library-not-found";
import { LIBRARY_TONE, StatusChip } from "./library-status-badge";
import { PanelHeader } from "./panel-header";
import { InlineNotice } from "./section-card";

const CODE_DELAY_MS = 1000;

function mockCode() {
  return Math.random().toString(36).slice(2, 10);
}

export function AdminLaunch({ libraryId }: { libraryId: string }) {
  const t = useTranslations("evidenceLibraryMock.admin");
  const tm = useTranslations("evidenceLibraryMock");
  const library = useEvidenceLibraryMockStore(selectLibrary(libraryId));
  const [creatingCode, setCreatingCode] = useState(false);

  if (!library) return <LibraryNotFound />;

  const base = `/evidence-libraries/${library.id}`;
  const adminAddress = `https://${library.address}/admin`;
  const ready = library.status === "active";

  function openAdmin() {
    if (creatingCode) return;
    setCreatingCode(true);
    // Fake the one-time-code round trip, then open the admin in a new tab.
    setTimeout(() => {
      setCreatingCode(false);
      window.open(`${adminAddress}?code=${mockCode()}`, "_blank", "noopener");
      toast.success(t("opened"), { description: t("openedDescription") });
    }, CODE_DELAY_MS);
  }

  return (
    <div className="w-full pb-16">
      <div className="sticky top-14 z-20 border-b border-border/40 bg-background lg:top-0">
        <div className="container mx-auto max-w-6xl px-4 sm:px-6">
          <PanelHeader
            icon={Layers}
            className="border-b-0 px-0 md:px-0"
            title={library.name}
            eyebrow={`https://${library.address}`}
            backHref="/evidence-libraries"
            backLabel={t("backToLibraries")}
            titleAside={
              <StatusChip tone={LIBRARY_TONE[library.status]} data-status={library.status}>
                {tm(`status.${library.status}`)}
              </StatusChip>
            }
          >
            <Button asChild variant="outline">
              <Link href={`${base}/configuration`}>
                <Settings />
                {t("configure")}
              </Link>
            </Button>
          </PanelHeader>
        </div>
      </div>

      <div className="container mx-auto max-w-6xl p-4 sm:p-6">
        <CommandCenterContainer>
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
                        <span className="font-mono">{library.activeRev ?? t("noneYet")}</span>
                      ),
                    },
                  ]}
                />
                <PanelRow title={t("ownerTitle")} hint={t("ownerHint")} />
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
                      <Button asChild size="sm" variant="outline" className="h-7">
                        <Link href={`${base}/setup`}>{t("viewSetup")}</Link>
                      </Button>
                    }
                  >
                    {t("notReadyHint")}
                  </InlineNotice>
                )}
              </div>
            </FieldGroup>
          </div>
        </CommandCenterContainer>
      </div>
    </div>
  );
}
