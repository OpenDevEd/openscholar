"use client";

import { useAction } from "convex/react";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";

export function EvidenceLibraryAdminLaunch({
  libraryId,
}: {
  libraryId: string;
}) {
  const t = useTranslations("evidenceLibraryAdminLaunch");
  const launchState = useProtectedQuery(
    api.evidenceLibraries.queries.getAdminLaunchState,
    { libraryId },
  );
  const issueAdminLoginCode = useAction(
    api.evidenceLibraries.adminLoginCodeActions.issueAdminLoginCode,
  );
  const [isOpening, setIsOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  function handleOpenAdmin() {
    const library = launchState.data;
    if (!library || library.status !== "ready" || isOpening) return;

    setIsOpening(true);
    setOpenError(null);
    void issueAdminLoginCode({ libraryId: library.libraryId })
      .then(({ launchUrl }) => {
        window.location.href = launchUrl;
      })
      .catch(() => {
        setOpenError(t("openError"));
        setIsOpening(false);
      });
  }

  if (!launchState.isReady || launchState.data === undefined) {
    return <AuthStatePanel variant="loading" loadingStyle="spinner" />;
  }

  if (launchState.data === null) {
    return (
      <AuthStatePanel
        variant="no_access"
        title={t("noAccessTitle")}
        description={t("noAccessDescription")}
      />
    );
  }

  if (launchState.data.status === "not_ready") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("notReadyTitle")}</CardTitle>
          <CardDescription>{t("notReadyDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="font-medium">{launchState.data.libraryName}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t("readyTitle", { libraryName: launchState.data.libraryName })}
        </CardTitle>
        <CardDescription>{t("readyDescription")}</CardDescription>
      </CardHeader>
      {openError ? (
        <CardContent>
          <p role="alert" className="text-sm text-destructive">
            {openError}
          </p>
        </CardContent>
      ) : null}
      <CardFooter className="justify-end">
        <Button type="button" onClick={handleOpenAdmin} disabled={isOpening}>
          <ExternalLink aria-hidden />
          {isOpening ? t("openingAdmin") : t("openAdmin")}
        </Button>
      </CardFooter>
    </Card>
  );
}
