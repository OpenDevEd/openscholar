"use client";

import { Building2, Check, ChevronRight, Layers, Lock, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState } from "react";
import { toast } from "sonner";
import { CommandCenterContainer } from "@/components/command-center/command-center-container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { addressFor, slugify } from "@/lib/evidence-libraries/mock/data";
import {
  selectOrganization,
  useEvidenceLibraryMockStore,
} from "@/lib/evidence-libraries/mock/store";
import { FieldError, SectionCard } from "./section-card";
import { OrgAvatar } from "./org-avatar";
import { PanelHeader } from "./panel-header";

const NAME_MAX = 100;

export function NewLibraryForm() {
  const t = useTranslations("evidenceLibraryMock.new");
  const tm = useTranslations("evidenceLibraryMock");
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

  const nameId = useId();
  const shortId = useId();
  const addressId = useId();

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
    <div className="container mx-auto max-w-6xl p-4 sm:p-6">
      <div className="mb-4 flex justify-end">
      </div>
      <CommandCenterContainer>
        <PanelHeader icon={Plus} title={t("title")} description={t("description")} />

        <form onSubmit={handleSubmit} noValidate className="max-w-2xl space-y-4 p-4 md:p-6">
          <SectionCard icon={Building2} title={t("ownerTitle")} description={t("ownerDescription")}>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{tm("organizationLabel")}</dt>
              <dd className="flex items-center gap-2 font-medium">
                <OrgAvatar initials={org.initials} color={org.color} className="size-5 text-[9px]" />
                {org.name}
              </dd>
              <dt className="text-muted-foreground">{t("yourRole")}</dt>
              <dd>
                {tm("roleOwner")}{" "}
                <code className="text-xs font-mono text-muted-foreground">org:admin</code>
              </dd>
            </dl>
          </SectionCard>

          <SectionCard icon={Layers} title={t("libraryTitle")} description={t("libraryDescription")}>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor={nameId}>{t("nameLabel")}</Label>
                <span className="text-xs font-mono text-muted-foreground" aria-live="polite">
                  {name.length} / {NAME_MAX}
                </span>
              </div>
              <Input
                id={nameId}
                autoFocus
                autoComplete="off"
                maxLength={NAME_MAX}
                className="bg-background"
                placeholder={t("namePlaceholder")}
                value={name}
                aria-invalid={nameError || undefined}
                onChange={(e) => {
                  setName(e.target.value);
                  setShowNameError(false);
                }}
              />
              {nameError ? <FieldError>{t("nameError")}</FieldError> : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={shortId}>{t("shortNameLabel")}</Label>
              <Input
                id={shortId}
                className="bg-background font-mono text-sm"
                autoComplete="off"
                spellCheck={false}
                placeholder={t("shortNamePlaceholder")}
                value={shortNameInput ?? shortName}
                readOnly={isReserved}
                onChange={(e) => setShortNameInput(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("shortNameHint")}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={addressId}>{t("addressLabel")}</Label>
              <div className="flex flex-col gap-1.5 sm:flex-row">
                <div className="relative flex-1">
                  <Input
                    id={addressId}
                    readOnly
                    value={address}
                    data-address-state={isReserved ? "reserved" : "open"}
                    className={cn(
                      "bg-background pr-9 font-mono text-sm",
                      isReserved && "border-emerald-500/40 bg-emerald-500/5",
                    )}
                  />
                  {isReserved ? (
                    <Check className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-500" />
                  ) : null}
                </div>
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
              ) : isReserved ? (
                <p
                  className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400"
                  role="status"
                >
                  <Check className="h-3.5 w-3.5" />
                  {t("reserved")}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">{t("addressHint")}</p>
              )}
            </div>
          </SectionCard>

          <div className="flex justify-end gap-2 pt-2">
            <Button asChild type="button" variant="ghost">
              <Link href="/evidence-libraries">{tc("cancel")}</Link>
            </Button>
            <Button type="submit" disabled={!canContinue}>
              {tc("continue")}
              <ChevronRight />
            </Button>
          </div>
        </form>
      </CommandCenterContainer>
    </div>
  );
}
