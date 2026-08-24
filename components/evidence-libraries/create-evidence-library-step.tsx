"use client";

import { useOrganization } from "@clerk/nextjs";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FormEvent, useState } from "react";
import { api } from "@/convex/_generated/api";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { MAX_EVIDENCE_LIBRARY_NAME_LENGTH } from "@/lib/evidence-libraries/setup/naming";

type ActiveOrganizationProps = {
  name: string;
};

function ActiveOrganization({ name }: ActiveOrganizationProps) {
  const t = useTranslations("evidenceLibrarySetup");

  return (
    <div className="rounded-lg border bg-muted/35 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("activeOrganizationLabel")}
      </p>
      <p className="mt-1 font-medium text-foreground">{name}</p>
    </div>
  );
}

function AdminCreateEvidenceLibraryForm() {
  const t = useTranslations("evidenceLibrarySetup");
  const router = useRouter();
  const createSetupDraft = useMutation(
    api.evidenceLibraries.mutations.createSetupDraft,
  );
  const currentSetupQuery = useProtectedQuery(
    api.evidenceLibraries.queries.getCurrentSetupDraft,
    {},
  );
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const currentSetup = currentSetupQuery.data;
  const normalizedName = name.trim();
  const canPreview =
    currentSetup === null &&
    normalizedName.length > 0 &&
    Array.from(normalizedName).length <= MAX_EVIDENCE_LIBRARY_NAME_LENGTH;
  const previewQuery = useProtectedQuery(
    api.evidenceLibraries.queries.previewSetupDraftName,
    canPreview ? { name: normalizedName } : "skip",
  );
  const identity = currentSetup ?? previewQuery.data;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!identity || isSubmitting) return;

    if (currentSetup) {
      router.push(
        `/evidence-libraries/${currentSetup.libraryId}/configuration`,
      );
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    void createSetupDraft({ name: identity.name })
      .then((created) => {
        router.push(
          `/evidence-libraries/${created.libraryId}/configuration`,
        );
      })
      .catch(() => {
        setSubmitError(t("createError"));
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  }

  if (currentSetup === undefined) {
    return <AuthStatePanel variant="loading" loadingStyle="spinner" />;
  }

  const isSavedDraft = currentSetup !== null;
  const canContinue = Boolean(identity) && !isSubmitting;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("detailsTitle")}</CardTitle>
        <CardDescription>
          {isSavedDraft ? t("savedDraftDescription") : t("detailsDescription")}
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="evidence-library-name">
              {t("libraryNameLabel")}
            </Label>
            <Input
              id="evidence-library-name"
              name="name"
              value={isSavedDraft ? currentSetup.name : name}
              onChange={(event) => setName(event.target.value)}
              maxLength={MAX_EVIDENCE_LIBRARY_NAME_LENGTH}
              readOnly={isSavedDraft}
              autoComplete="organization-title"
              required
            />
            <p className="text-sm text-muted-foreground">
              {t("libraryNameHelp")}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="evidence-library-short-name">
              {t("shortNameLabel")}
            </Label>
            <Input
              id="evidence-library-short-name"
              value={identity?.shortName ?? ""}
              readOnly
              aria-describedby="evidence-library-short-name-help"
            />
            <p
              id="evidence-library-short-name-help"
              className="text-sm text-muted-foreground"
            >
              {t("shortNameHelp")}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="evidence-library-public-address">
              {t("publicAddressLabel")}
            </Label>
            <Input
              id="evidence-library-public-address"
              value={identity?.publicAddress ?? ""}
              readOnly
              aria-describedby="evidence-library-public-address-help"
            />
            <p
              id="evidence-library-public-address-help"
              className="text-sm text-muted-foreground"
              aria-live="polite"
            >
              {canPreview && previewQuery.data === undefined
                ? t("checkingAddress")
                : t("publicAddressHelp")}
            </p>
          </div>

          {submitError ? (
            <p role="alert" className="text-sm text-destructive">
              {submitError}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="mt-6 justify-end border-t">
          <Button type="submit" disabled={!canContinue}>
            {isSubmitting ? t("continuing") : t("continue")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export function CreateEvidenceLibraryStep() {
  const t = useTranslations("evidenceLibrarySetup");
  const { isLoaded, membership, organization } = useOrganization();

  if (!isLoaded) {
    return <AuthStatePanel variant="loading" loadingStyle="spinner" />;
  }

  if (!organization) {
    return (
      <AuthStatePanel
        variant="no_access"
        title={t("noActiveOrganizationTitle")}
        description={t("noActiveOrganizationDescription")}
      />
    );
  }

  return (
    <div className="space-y-6">
      <ActiveOrganization name={organization.name} />
      {membership === undefined ? (
        <AuthStatePanel variant="loading" loadingStyle="spinner" />
      ) : membership?.role === "org:admin" ? (
        <AdminCreateEvidenceLibraryForm key={organization.id} />
      ) : (
        <AuthStatePanel
          variant="no_access"
          title={t("adminOnlyTitle")}
          description={t("adminOnlyDescription")}
        />
      )}
    </div>
  );
}
