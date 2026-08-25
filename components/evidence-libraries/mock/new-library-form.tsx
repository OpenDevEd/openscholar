"use client";

import { Building2, Check, ChevronRight, Layers, Lock, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState } from "react";
import { toast } from "sonner";
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
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { addressFor, slugify } from "@/lib/evidence-libraries/mock/data";
import {
  selectOrganization,
  useEvidenceLibraryMockStore,
} from "@/lib/evidence-libraries/mock/store";
import { OrgAvatar } from "./org-avatar";
import { PrototypeBadge } from "./prototype-badge";

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
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
      <div className="mb-4 flex justify-end">
        <PrototypeBadge />
      </div>
      <PageHeader title={t("title")} description={t("description")} icon={Plus} />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="size-4 text-primary" />
            {t("ownerTitle")}
          </CardTitle>
          <CardDescription>{t("ownerDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{tm("organizationLabel")}</dt>
            <dd className="flex items-center gap-2 font-medium">
              <OrgAvatar initials={org.initials} color={org.color} className="size-5 text-[9px]" />
              {org.name}
            </dd>
            <dt className="text-muted-foreground">{t("yourRole")}</dt>
            <dd>
              {tm("roleOwner")} <span className="font-mono">org:admin</span>
            </dd>
          </dl>
        </CardContent>
      </Card>

      <form onSubmit={handleSubmit} noValidate>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="size-4 text-primary" />
              {t("libraryTitle")}
            </CardTitle>
            <CardDescription>{t("libraryDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor={nameId}>{t("nameLabel")}</Label>
                <span className="font-mono text-xs text-muted-foreground" aria-live="polite">
                  {name.length} / {NAME_MAX}
                </span>
              </div>
              <Input
                id={nameId}
                autoFocus
                autoComplete="off"
                maxLength={NAME_MAX}
                placeholder={t("namePlaceholder")}
                value={name}
                aria-invalid={nameError || undefined}
                onChange={(e) => {
                  setName(e.target.value);
                  setShowNameError(false);
                }}
              />
              {nameError ? (
                <p className="text-xs text-destructive" role="alert">
                  {t("nameError")}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor={shortId}>{t("shortNameLabel")}</Label>
              <Input
                id={shortId}
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
                placeholder={t("shortNamePlaceholder")}
                value={shortNameInput ?? shortName}
                readOnly={isReserved}
                onChange={(e) => setShortNameInput(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("shortNameHint")}</p>
            </div>

            <div className="space-y-2">
              <Label>{t("addressLabel")}</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div
                  data-address-state={isReserved ? "reserved" : "open"}
                  className={cn(
                    "flex h-9 flex-1 items-center gap-2 rounded-md border bg-muted/40 px-3 font-mono text-sm",
                    isReserved && "border-emerald-600/50 bg-emerald-600/10",
                  )}
                >
                  <span className="truncate">{address}</span>
                  {isReserved ? (
                    <Check className="ml-auto size-4 shrink-0 text-emerald-600" />
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
                <div className="flex flex-wrap items-center gap-2 text-xs text-destructive" role="alert">
                  <span>{t("taken", { alt: takenAlt })}</span>
                  <Button type="button" size="xs" variant="outline" onClick={useAlternative}>
                    {t("useAlt", { alt: takenAlt })}
                  </Button>
                </div>
              ) : isReserved ? (
                <p className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400" role="status">
                  <Check className="size-3.5" />
                  {t("reserved")}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">{t("addressHint")}</p>
              )}
            </div>
          </CardContent>
          <CardFooter className="justify-end gap-2">
            <Button asChild type="button" variant="ghost">
              <Link href="/evidence-libraries">{tc("cancel")}</Link>
            </Button>
            <Button type="submit" disabled={!canContinue}>
              {tc("continue")}
              <ChevronRight />
            </Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
