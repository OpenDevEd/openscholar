"use client";

import { useOrganization } from "@clerk/nextjs";
import { useAction } from "convex/react";
import { Check, Lock, RotateCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { initialsOf } from "@/lib/evidence-libraries/initials";
import {
  createInitialEvidenceLibraryShortName,
  MAX_EVIDENCE_LIBRARY_NAME_LENGTH,
  normalizeEvidenceLibraryName,
} from "@/lib/evidence-libraries/setup/naming";
import { StatusChip } from "./configuration/status-chip";
import { FieldGroup, PanelRow, ReadOnlyValue } from "./configuration/fields";
import { Field } from "./configuration/section-card";
import { LibraryPageShell } from "./library-page-shell";

type Reserved = {
  libraryId: Id<"evidenceLibraries">;
  name: string;
  shortName: string;
  publicAddress: string;
};

// What the server says about the typed name. The form never guesses.
type AddressCheck =
  | { status: "checking"; name: string }
  | { status: "available"; name: string; publicAddress: string }
  | {
      status: "name-taken";
      name: string;
      libraryId: Id<"evidenceLibraries">;
    }
  | {
      status: "failed";
      name: string;
      reason: "address-taken" | "check-failed" | "no-address";
    };

const CHECK_DELAY_MS = 300;

export function NewLibraryForm() {
  const t = useTranslations("evidenceLibraries.new");
  const tGate = useTranslations("evidenceLibraries.gate");
  const { isLoaded, membership, organization } = useOrganization();
  const access = useProtectedQuery(
    api.evidenceLibraries.queries.getEvidenceLibrariesAccess,
    organization ? {} : "skip",
  );

  if (!isLoaded) {
    return <AuthStatePanel variant="loading" loadingStyle="spinner" />;
  }
  if (!organization) {
    return (
      <AuthStatePanel
        variant="no_access"
        title={t("noOrganizationTitle")}
        description={t("noOrganizationDescription")}
      />
    );
  }
  if (membership === undefined || access.data === undefined) {
    return <AuthStatePanel variant="loading" loadingStyle="spinner" />;
  }
  // Evidence Libraries are switched on per organisation in Clerk.
  if (!access.data.enabled) {
    return (
      <AuthStatePanel
        variant="no_access"
        title={tGate("title")}
        description={tGate("description")}
      />
    );
  }
  if (membership?.role !== "org:admin") {
    return (
      <AuthStatePanel
        variant="no_access"
        title={t("ownerOnlyTitle")}
        description={t("ownerOnlyDescription")}
      />
    );
  }
  // Switching organisation starts a fresh form.
  return <OwnerForm key={organization.id} organizationName={organization.name} />;
}

function OwnerForm({ organizationName }: { organizationName: string }) {
  const t = useTranslations("evidenceLibraries.new");
  const tc = useTranslations("common");
  const router = useRouter();
  const checkAddress = useAction(
    api.evidenceLibraries.addressActions.checkAddress,
  );
  const reserveAddress = useAction(
    api.evidenceLibraries.addressActions.reserveAddress,
  );

  const [name, setName] = useState("");
  const [check, setCheck] = useState<AddressCheck | null>(null);
  const [reserving, setReserving] = useState(false);
  const [reserved, setReserved] = useState<Reserved | null>(null);
  const [showNameError, setShowNameError] = useState(false);
  // Waits for typing to pause, and ignores an answer to an older name.
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wantedName = useRef("");

  // Outside system: the browser timer that waits for typing to pause. React
  // has no other way to stop it when the page or organisation changes.
  useEffect(
    () => () => {
      if (checkTimer.current) clearTimeout(checkTimer.current);
    },
    [],
  );

  const trimmed = normalizeEvidenceLibraryName(name);
  // The short name follows the typed name straight away. The address is
  // only ever the one the server says is free.
  const shortName =
    reserved?.shortName ??
    (trimmed ? createInitialEvidenceLibraryShortName(trimmed) : "");
  const current = check && check.name === trimmed ? check : null;
  const address = reserved
    ? reserved.publicAddress.replace(/^https?:\/\//, "")
    : current?.status === "available"
      ? current.publicAddress.replace(/^https?:\/\//, "")
      : "";
  // A name is typed but there is no address to show: a dash, never the
  // "type a name" hint.
  const addressText =
    address ||
    (current?.status === "checking"
      ? t("checkingAddress")
      : trimmed
        ? "—"
        : t("addressPending"));
  const nameError = showNameError && !trimmed;

  function runCheck(wanted: string) {
    wantedName.current = wanted;
    setCheck({ status: "checking", name: wanted });
    void checkAddress({ name: wanted })
      .then((result) => {
        if (wantedName.current !== wanted) return;
        if (result.status === "available") {
          setCheck({
            status: "available",
            name: wanted,
            publicAddress: result.publicAddress,
          });
          return;
        }
        if (result.status === "name-taken") {
          setCheck({
            status: "name-taken",
            name: wanted,
            libraryId: result.libraryId,
          });
          return;
        }
        setCheck({ status: "failed", name: wanted, reason: result.reason });
      })
      .catch(() => {
        if (wantedName.current !== wanted) return;
        setCheck({ status: "failed", name: wanted, reason: "check-failed" });
      });
  }

  function handleNameChange(value: string) {
    setName(value);
    setShowNameError(false);
    if (checkTimer.current) clearTimeout(checkTimer.current);
    const wanted = normalizeEvidenceLibraryName(value);
    wantedName.current = wanted;
    if (!wanted) {
      setCheck(null);
      return;
    }
    setCheck({ status: "checking", name: wanted });
    checkTimer.current = setTimeout(() => runCheck(wanted), CHECK_DELAY_MS);
  }

  function handleReserve() {
    if (reserving || reserved) return;
    if (!trimmed) {
      setShowNameError(true);
      return;
    }
    setReserving(true);
    void reserveAddress({ name: trimmed })
      .then((result) => {
        if (result.status === "name-taken") {
          setCheck({
            status: "name-taken",
            name: trimmed,
            libraryId: result.libraryId,
          });
          return;
        }
        if (result.status === "address-taken") {
          setCheck({
            status: "failed",
            name: trimmed,
            reason: "address-taken",
          });
          return;
        }
        if (result.status === "unavailable") {
          setCheck({ status: "failed", name: trimmed, reason: result.reason });
          return;
        }
        setReserved({
          libraryId: result.libraryId,
          name: result.name,
          shortName: result.shortName,
          publicAddress: result.publicAddress,
        });
        toast.success(t("reservedToast"), {
          description: t("reservedToastDescription", { address: result.publicAddress }),
        });
      })
      .catch(() =>
        setCheck({ status: "failed", name: trimmed, reason: "check-failed" }),
      )
      .finally(() => setReserving(false));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reserved) return;
    router.push(`/evidence-libraries/${reserved.libraryId}/configuration`);
  }

  return (
    <LibraryPageShell
      title={t("title")}
      description={t("description")}
      backHref="/evidence-libraries"
      backLabel={t("backToLibraries")}
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-5 p-4 md:p-6">
        <FieldGroup title={t("ownerTitle")}>
          <PanelRow
            leading={
              <span
                aria-hidden="true"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-[10px] font-bold text-white"
              >
                {initialsOf(organizationName)}
              </span>
            }
            title={t("ownedBy", { organization: organizationName })}
            hint={t("ownerHint")}
          />
        </FieldGroup>

        <FieldGroup title={t("libraryTitle")} hint={t("libraryDescription")}>
          <Field
            label={t("nameLabel")}
            error={
              nameError ? (
                t("nameError")
              ) : current?.status === "name-taken" ? (
                <>
                  {t("nameTaken", { name: trimmed })}{" "}
                  <Link
                    className="underline underline-offset-2"
                    href={`/evidence-libraries/${current.libraryId}/configuration`}
                  >
                    {t("openExisting")}
                  </Link>
                </>
              ) : null
            }
            counter={
              // The limit appears only when it is reached.
              Array.from(name).length >= MAX_EVIDENCE_LIBRARY_NAME_LENGTH ? (
                <span aria-live="polite">
                  {Array.from(name).length} / {MAX_EVIDENCE_LIBRARY_NAME_LENGTH}
                </span>
              ) : null
            }
          >
            {(id, invalid) =>
              reserved ? (
                <ReadOnlyValue id={id} value={reserved.name} mono={false} />
              ) : (
                <Input
                  id={id}
                  autoFocus
                  autoComplete="off"
                  maxLength={MAX_EVIDENCE_LIBRARY_NAME_LENGTH}
                  className="bg-background"
                  placeholder={t("namePlaceholder")}
                  value={name}
                  aria-invalid={invalid || undefined}
                  onChange={(e) => handleNameChange(e.target.value)}
                />
              )
            }
          </Field>

          <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
            <Field label={t("shortNameLabel")} hint={reserved ? undefined : t("shortNameHint")}>
              {(id) => (
                <ReadOnlyValue
                  id={id}
                  value={shortName || t("addressPending")}
                  mono={false}
                  locked={Boolean(reserved)}
                />
              )}
            </Field>

            <Field
              label={t("addressLabel")}
              hint={reserved ? undefined : t("addressHint")}
              error={
                current?.status === "failed"
                  ? t(
                      current.reason === "no-address"
                        ? "noAddress"
                        : current.reason === "address-taken"
                          ? "addressTaken"
                          : "checkFailed",
                    )
                  : null
              }
              counter={
                reserved ? (
                  <StatusChip tone="success" role="status" data-address-state="reserved">
                    <Check />
                    {t("reserved")}
                  </StatusChip>
                ) : null
              }
            >
              {(id) => (
                <div className="flex flex-col gap-1.5 sm:flex-row">
                  <ReadOnlyValue
                    id={id}
                    value={addressText}
                    title={address || undefined}
                    locked={Boolean(reserved)}
                    className="min-w-0 flex-1"
                  />
                  {reserved ? null : current?.status === "failed" ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => runCheck(trimmed)}
                    >
                      <RotateCw />
                      {t("tryAgain")}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={current?.status !== "available" || reserving}
                      onClick={handleReserve}
                    >
                      {reserving ? <Spinner /> : <Lock />}
                      {reserving ? t("checking") : t("reserve")}
                    </Button>
                  )}
                </div>
              )}
            </Field>
          </div>
        </FieldGroup>

        <div className="flex justify-end gap-2 border-t border-border/50 pt-5">
          <Button asChild type="button" variant="ghost">
            <Link href="/evidence-libraries">{tc("cancel")}</Link>
          </Button>
          <Button type="submit" disabled={!reserved}>
            {tc("continue")}
          </Button>
        </div>
      </form>
    </LibraryPageShell>
  );
}
