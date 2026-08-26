"use client";

import { Check, Layers, Lock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { CommandCenterContainer } from "@/components/command-center/command-center-container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { addressFor, slugify } from "@/lib/evidence-libraries/mock/data";
import {
  selectOrganization,
  useEvidenceLibraryMockStore,
} from "@/lib/evidence-libraries/mock/store";
import { FieldGroup, PanelRow, ReadOnlyValue } from "./config/fields";
import { StatusChip } from "./library-status-badge";
import { OrgAvatar } from "./org-avatar";
import { PanelHeader } from "./panel-header";
import { Field, FieldError } from "./section-card";

const NAME_MAX = 100;

export function NewLibraryForm() {
  const t = useTranslations("evidenceLibraryMock.new");
  const tc = useTranslations("common");
  const router = useRouter();
  const org = useEvidenceLibraryMockStore(selectOrganization);
  const reserving = useEvidenceLibraryMockStore((s) => s.reserving);
  const reserveAddress = useEvidenceLibraryMockStore((s) => s.reserveAddress);
  const createLibrary = useEvidenceLibraryMockStore((s) => s.createLibrary);

  const [name, setName] = useState("");
  const [shortNameInput, setShortNameInput] = useState<string | null>(null);
  const [reserved, setReserved] = useState<string | null>(null);
  const [takenAlt, setTakenAlt] = useState<string | null>(null);
  const [showNameError, setShowNameError] = useState(false);

  // The short name follows the name until the owner edits it by hand.
  const shortName = slugify(shortNameInput ?? name);
  const address = addressFor(shortName);
  const isReserved = reserved !== null && reserved === shortName;
  const canContinue = isReserved && name.trim().length > 0;

  async function handleReserve() {
    if (!shortName || reserving) return;
    setTakenAlt(null);
    const { taken } = await reserveAddress(shortName);
    if (taken) {
      setTakenAlt(`${shortName}-2`);
      return;
    }
    setReserved(shortName);
    toast.success(t("reservedToast"), {
      description: t("reservedToastDescription", { address: addressFor(shortName) }),
    });
  }

  function useAlternative() {
    if (!takenAlt) return;
    setShortNameInput(takenAlt);
    setTakenAlt(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setShowNameError(true);
      return;
    }
    if (!canContinue) return;
    const id = createLibrary(name.trim(), shortName);
    toast.success(t("draftCreated"), {
      description: t("draftCreatedDescription", { name: name.trim() }),
    });
    router.push(`/evidence-libraries/${id}/configuration`);
  }

  const nameError = showNameError && !name.trim();

  return (
    <div className="w-full pb-16">
      {/* Sticky header: same bar as the configuration page */}
      <div className="sticky top-14 z-20 border-b border-border/40 bg-background lg:top-0">
        <div className="container mx-auto max-w-6xl px-4 sm:px-6">
          <PanelHeader
            icon={Layers}
            className="border-b-0 px-0 md:px-0"
            title={t("title")}
            description={t("description")}
            backHref="/evidence-libraries"
            backLabel={t("backToLibraries")}
          />
        </div>
      </div>

      <div className="container mx-auto max-w-6xl p-4 sm:p-6">
        <CommandCenterContainer>
          <form onSubmit={handleSubmit} noValidate className="space-y-5 p-4 md:p-6">
            <FieldGroup title={t("ownerTitle")}>
              <PanelRow
                leading={<OrgAvatar initials={org.initials} color={org.color} />}
                title={t("ownedBy", { organization: org.name })}
                hint={t("ownerHint")}
              />
            </FieldGroup>

            <FieldGroup title={t("libraryTitle")} hint={t("libraryDescription")}>
              <Field
                label={t("nameLabel")}
                error={nameError ? t("nameError") : null}
                counter={
                  <span aria-live="polite">
                    {name.length} / {NAME_MAX}
                  </span>
                }
              >
                {(id, invalid) => (
                  <Input
                    id={id}
                    autoFocus
                    autoComplete="off"
                    maxLength={NAME_MAX}
                    className="bg-background"
                    placeholder={t("namePlaceholder")}
                    value={name}
                    aria-invalid={invalid || undefined}
                    onChange={(e) => {
                      setName(e.target.value);
                      setShowNameError(false);
                    }}
                  />
                )}
              </Field>

              <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
              <Field label={t("shortNameLabel")} hint={isReserved ? undefined : t("shortNameHint")}>
                {(id) =>
                  isReserved ? (
                    <ReadOnlyValue id={id} value={shortName} />
                  ) : (
                    <Input
                      id={id}
                      className="bg-background font-mono text-sm"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={t("shortNamePlaceholder")}
                      value={shortNameInput ?? shortName}
                      onChange={(e) => setShortNameInput(e.target.value)}
                    />
                  )
                }
              </Field>

              <Field
                label={t("addressLabel")}
                hint={isReserved || takenAlt ? undefined : t("addressHint")}
                counter={
                  isReserved ? (
                    <StatusChip tone="success" role="status" data-address-state="reserved">
                      <Check />
                      {t("reserved")}
                    </StatusChip>
                  ) : null
                }
              >
                {(id) => (
                  <div className="flex flex-col gap-1.5 sm:flex-row">
                    <ReadOnlyValue id={id} value={address} className="min-w-0 flex-1" />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!shortName || isReserved || reserving}
                      onClick={handleReserve}
                    >
                      {reserving ? <Spinner /> : <Lock />}
                      {reserving ? t("checking") : t("reserve")}
                    </Button>
                  </div>
                )}
              </Field>
              </div>
              {takenAlt ? (
                <FieldError
                  action={
                    <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5" onClick={useAlternative}>
                      {t("useAlt", { alt: takenAlt })}
                    </Button>
                  }
                >
                  {t("taken", { alt: takenAlt })}
                </FieldError>
              ) : null}
            </FieldGroup>

            <div className="flex justify-end gap-2 border-t border-border/50 pt-5">
              <Button asChild type="button" variant="ghost">
                <Link href="/evidence-libraries">{tc("cancel")}</Link>
              </Button>
              <Button type="submit" disabled={!canContinue}>
                {tc("continue")}
              </Button>
            </div>
          </form>
        </CommandCenterContainer>
      </div>
    </div>
  );
}
