"use client";

import { useTranslations } from "next-intl";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";

export function EvidenceLibraryConfigurationShell({
  libraryId,
}: {
  libraryId: string;
}) {
  const t = useTranslations("evidenceLibraryConfigurationShell");
  const setupQuery = useProtectedQuery(
    api.evidenceLibraries.queries.getSetupDraft,
    { libraryId: libraryId as Id<"evidenceLibraries"> },
  );

  if (setupQuery.data === undefined) {
    return <AuthStatePanel variant="loading" loadingStyle="spinner" />;
  }

  const { identity } = setupQuery.data;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:py-14">
      <header className="mb-8 space-y-2">
        <p className="text-sm font-medium text-primary">{t("eyebrow")}</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {identity.name}
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          {t("description")}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t("identityTitle")}</CardTitle>
          <CardDescription>{t("identityDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="configuration-library-name">
              {t("libraryNameLabel")}
            </Label>
            <Input
              id="configuration-library-name"
              value={identity.name}
              readOnly
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="configuration-library-short-name">
              {t("shortNameLabel")}
            </Label>
            <Input
              id="configuration-library-short-name"
              value={identity.shortName}
              readOnly
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="configuration-library-address">
              {t("publicAddressLabel")}
            </Label>
            <Input
              id="configuration-library-address"
              value={identity.publicAddress}
              readOnly
            />
            <p className="text-sm text-muted-foreground">
              {t("publicAddressHelp")}
            </p>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
