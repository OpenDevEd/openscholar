"use client";

import { useOrganization } from "@clerk/nextjs";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  parseAsString,
  useQueryStates,
  type UseQueryStatesReturn,
} from "nuqs";
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

const setupSelectionParsers = {
  libraryId: parseAsString,
  organizationId: parseAsString,
};

type SetupSelectionState = UseQueryStatesReturn<
  typeof setupSelectionParsers
>[0];
type SetupSelectionSetter = UseQueryStatesReturn<
  typeof setupSelectionParsers
>[1];

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

function AdminCreateEvidenceLibraryForm({
  activeOrganizationId,
  setSetupSelection,
  setupSelection,
}: {
  activeOrganizationId: string;
  setSetupSelection: SetupSelectionSetter;
  setupSelection: SetupSelectionState;
}) {
  const t = useTranslations("evidenceLibrarySetup");
  const router = useRouter();
  const createSetupDraft = useMutation(
    api.evidenceLibraries.mutations.createSetupDraft,
  );
  const selectedLibraryId =
    setupSelection.organizationId === activeOrganizationId
      ? setupSelection.libraryId
      : null;
  const selectedSetupQuery = useProtectedQuery(
    api.evidenceLibraries.queries.getSetupDraftSelection,
    selectedLibraryId ? { libraryId: selectedLibraryId } : "skip",
  );
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const selectedSetup = selectedLibraryId ? selectedSetupQuery.data : null;
  const normalizedName = name.trim();
  const canCreate =
    normalizedName.length > 0 &&
    Array.from(normalizedName).length <= MAX_EVIDENCE_LIBRARY_NAME_LENGTH;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    if (selectedSetup) {
      router.push(
        `/evidence-libraries/${selectedSetup.library._id}/configuration`,
      );
      return;
    }
    if (!canCreate) return;

    const requestOrganizationId = activeOrganizationId;
    setIsSubmitting(true);
    setSubmitError(null);
    void (async () => {
      try {
        const claimedSelection = await setSetupSelection({
          libraryId: null,
          organizationId: requestOrganizationId,
        });
        const created = await createSetupDraft({ name: normalizedName });
        await setSetupSelection((current) =>
          (current.organizationId ??
            claimedSelection.get("organizationId")) === requestOrganizationId
            ? { libraryId: created.libraryId }
            : {},
        );
      } catch {
        setSubmitError(t("createError"));
      } finally {
        setIsSubmitting(false);
      }
    })();
  }

  if (
    !selectedSetupQuery.isReady ||
    (selectedLibraryId && selectedSetup === undefined)
  ) {
    return <AuthStatePanel variant="loading" loadingStyle="spinner" />;
  }

  const isSavedDraft = selectedSetup !== null && selectedSetup !== undefined;
  const canContinue = (isSavedDraft || canCreate) && !isSubmitting;

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
              value={isSavedDraft ? selectedSetup.identity.name : name}
              onChange={(event) => setName(event.target.value)}
              readOnly={isSavedDraft}
              autoComplete="organization-title"
              required
            />
            <p className="text-sm text-muted-foreground">
              {t("libraryNameHelp")}
            </p>
          </div>

          {isSavedDraft ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="evidence-library-short-name">
                  {t("shortNameLabel")}
                </Label>
                <Input
                  id="evidence-library-short-name"
                  value={selectedSetup.identity.shortName}
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
                  value={selectedSetup.identity.publicAddress}
                  readOnly
                  aria-describedby="evidence-library-public-address-help"
                />
                <p
                  id="evidence-library-public-address-help"
                  className="text-sm text-muted-foreground"
                >
                  {t("publicAddressHelp")}
                </p>
              </div>
            </>
          ) : null}

          {submitError ? (
            <p role="alert" className="text-sm text-destructive">
              {submitError}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="mt-6 justify-end border-t">
          <Button type="submit" disabled={!canContinue}>
            {isSavedDraft
              ? t("continue")
              : isSubmitting
                ? t("reserving")
                : t("reserveAddress")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export function CreateEvidenceLibraryStep() {
  const t = useTranslations("evidenceLibrarySetup");
  const { isLoaded, membership, organization } = useOrganization();
  const [setupSelection, setSetupSelection] = useQueryStates(
    setupSelectionParsers,
    { history: "replace" },
  );

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
        <AdminCreateEvidenceLibraryForm
          key={organization.id}
          activeOrganizationId={organization.id}
          setSetupSelection={setSetupSelection}
          setupSelection={setupSelection}
        />
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
