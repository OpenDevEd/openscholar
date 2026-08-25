"use client";

import { AlertTriangle, ExternalLink, KeyRound, Play, Rocket, Settings, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import {
  selectLibrary,
  useEvidenceLibraryMockStore,
} from "@/lib/evidence-libraries/mock/store";
import { LibraryNotFound } from "./library-not-found";
import { LibraryStatusBadge } from "./library-status-badge";
import { PrototypeBadge } from "./prototype-badge";
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
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
      <div className="mb-4 flex justify-end">
        <PrototypeBadge />
      </div>
      <PageHeader
        title={t("title")}
        description={t("description", { name: library.name })}
        icon={KeyRound}
      />

      <Card className="mb-6">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{library.name}</CardTitle>
            <LibraryStatusBadge library={library} />
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t("publicAddress")}</dt>
            <dd>
              <a
                className="font-mono hover:underline"
                href={`https://${library.address}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {library.address}
              </a>
            </dd>
            <dt className="text-muted-foreground">{t("adminAddress")}</dt>
            <dd className="font-mono">https://{library.address}/admin</dd>
            <dt className="text-muted-foreground">{t("activeRevision")}</dt>
            <dd>
              {library.activeRev ? (
                <Badge variant="secondary" className="bg-emerald-600/15 font-mono text-emerald-700 dark:text-emerald-400">
                  {library.activeRev}
                </Badge>
              ) : (
                <span className="text-muted-foreground">{t("noneYet")}</span>
              )}
            </dd>
            <dt className="text-muted-foreground">{t("yourRole")}</dt>
            <dd>
              {tm("roleOwner")} <span className="font-mono">org:admin</span>
            </dd>
          </dl>
        </CardContent>
      </Card>

      {ready ? (
        <Card data-admin-state="ready">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4 text-primary" />
              {t("signInTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Alert>
              <ShieldCheck />
              <AlertDescription>{t("codeExplain")}</AlertDescription>
            </Alert>
          </CardContent>
          <CardFooter className="justify-end gap-2">
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
          </CardFooter>
        </Card>
      ) : (
        <Card data-admin-state="not-ready">
          <CardContent className="pt-6">
            <Alert>
              <AlertTriangle />
              <AlertTitle>{t("notReadyTitle")}</AlertTitle>
              <AlertDescription>{t("notReadyHint")}</AlertDescription>
            </Alert>
          </CardContent>
          <CardFooter className="justify-end">
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
          </CardFooter>
        </Card>
      )}

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
