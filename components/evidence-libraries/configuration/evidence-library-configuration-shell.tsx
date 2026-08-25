"use client";

import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { Id } from "@/convex/_generated/dataModel";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import type { EssentialConfigurationFormContract } from "@/lib/evidence-libraries/configuration/form-contract";
import type { EssentialConfigurationSections } from "@/lib/evidence-libraries/configuration/essential-configuration";

type FieldName =
  | "name"
  | "shortName"
  | "logo"
  | "favicon"
  | "accent"
  | "tertiary"
  | "availableLanguages"
  | "defaultLanguage";

const pointerToField: Record<string, FieldName> = {
  "/identity/name": "name",
  "/identity/shortName": "shortName",
  "/identity/assets/logoDark": "logo",
  "/identity/assets/favicon": "favicon",
  "/theme/colors/accent": "accent",
  "/theme/colors/tertiary": "tertiary",
  "/localization/locales": "availableLanguages",
  "/localization/defaultLocale": "defaultLanguage",
};

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function sectionPayload(
  sections: Array<{ sectionKey: string; payload: unknown }>,
  key: string,
) {
  return objectValue(
    sections.find((section) => section.sectionKey === key)?.payload,
  );
}

function readInitialConfiguration(
  sections: Array<{ sectionKey: string; payload: unknown }>,
  locales: string[],
): EssentialConfigurationSections {
  const identity = sectionPayload(sections, "identity");
  const assets = objectValue(identity.assets);
  const theme = sectionPayload(sections, "theme");
  const colors = objectValue(theme.colors);
  const localization = sectionPayload(sections, "localization");
  const savedLocales = Array.isArray(localization.locales)
    ? localization.locales.filter(
        (locale): locale is string =>
          typeof locale === "string" && locales.includes(locale),
      )
    : [];
  const availableLocales =
    savedLocales.length > 0 ? savedLocales : [locales[0]!];
  const savedDefaultLocale = stringValue(localization.defaultLocale);

  return {
    identity: {
      name: stringValue(identity.name),
      shortName: stringValue(identity.shortName),
      baseUrl: stringValue(identity.baseUrl),
      assets: {
        logoDark: stringValue(assets.logoDark),
        favicon: stringValue(assets.favicon),
      },
    },
    theme: {
      colors: {
        accent: stringValue(colors.accent, "#E68124"),
        tertiary: stringValue(colors.tertiary, "#5CACFD"),
      },
    },
    localization: {
      locales: availableLocales,
      defaultLocale: availableLocales.includes(savedDefaultLocale)
        ? savedDefaultLocale
        : availableLocales[0]!,
    },
  };
}

function cloneConfiguration(
  configuration: EssentialConfigurationSections,
): EssentialConfigurationSections {
  return {
    identity: {
      ...configuration.identity,
      assets: { ...configuration.identity.assets },
    },
    theme: { colors: { ...configuration.theme.colors } },
    localization: {
      locales: [...configuration.localization.locales],
      defaultLocale: configuration.localization.defaultLocale,
    },
  };
}

function fieldFromError(error: unknown): FieldName | undefined {
  const message = error instanceof Error ? error.message : String(error);
  return Object.entries(pointerToField).find(([pointer]) =>
    message.includes(pointer),
  )?.[1];
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

function SavedConfigurationPreview({
  configuration,
}: {
  configuration: EssentialConfigurationSections;
}) {
  const t = useTranslations("evidenceLibraryConfigurationShell");
  return (
    <div className="space-y-5 text-sm">
      <section>
        <h3 className="font-medium">{t("identityTitle")}</h3>
        <dl className="mt-2 grid gap-2">
          <div>
            <dt className="text-muted-foreground">{t("libraryNameLabel")}</dt>
            <dd>{configuration.identity.name}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("shortNameLabel")}</dt>
            <dd>{configuration.identity.shortName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("publicAddressLabel")}</dt>
            <dd className="break-all">{configuration.identity.baseUrl}</dd>
          </div>
        </dl>
      </section>
      <section>
        <h3 className="font-medium">{t("brandingTitle")}</h3>
        <dl className="mt-2 grid gap-2">
          <div>
            <dt className="text-muted-foreground">{t("logoLabel")}</dt>
            <dd className="break-all">
              {configuration.identity.assets.logoDark}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("faviconLabel")}</dt>
            <dd className="break-all">
              {configuration.identity.assets.favicon}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("accentColourLabel")}</dt>
            <dd>{configuration.theme.colors.accent}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {t("secondaryColourLabel")}
            </dt>
            <dd>{configuration.theme.colors.tertiary}</dd>
          </div>
        </dl>
      </section>
      <section>
        <h3 className="font-medium">{t("languagesTitle")}</h3>
        <p className="mt-2">{configuration.localization.locales.join(", ")}</p>
        <p className="text-muted-foreground">
          {t("defaultLanguagePreview", {
            language: configuration.localization.defaultLocale,
          })}
        </p>
      </section>
    </div>
  );
}

function EssentialConfigurationForm({
  formContract,
  initialConfiguration,
  initialEditVersion,
  libraryId,
}: {
  formContract: EssentialConfigurationFormContract;
  initialConfiguration: EssentialConfigurationSections;
  initialEditVersion: number;
  libraryId: Id<"evidenceLibraries">;
}) {
  const t = useTranslations("evidenceLibraryConfigurationShell");
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const saveConfiguration = useMutation(
    api.evidenceLibraries.mutations.saveEssentialConfiguration,
  );
  const activateConfiguration = useMutation(
    api.evidenceLibraries.mutations.activateConfiguration,
  );
  const [configuration, setConfiguration] = useState(() =>
    cloneConfiguration(initialConfiguration),
  );
  const [savedConfiguration, setSavedConfiguration] = useState(() =>
    cloneConfiguration(initialConfiguration),
  );
  const [editVersion, setEditVersion] = useState(initialEditVersion);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [status, setStatus] = useState<{
    message: string;
    result:
      | "save-success"
      | "save-error"
      | "activation-success"
      | "activation-error";
  } | null>(null);

  function clearError(field: FieldName) {
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setStatus(null);
  }

  function focusField(field: FieldName) {
    const control = formRef.current?.elements.namedItem(field);
    if (control instanceof HTMLElement) control.focus();
  }

  function validateVisibleFields(form: HTMLFormElement) {
    const controls = Array.from(form.elements).filter(
      (control): control is HTMLInputElement | HTMLSelectElement =>
        control instanceof HTMLInputElement ||
        control instanceof HTMLSelectElement,
    );
    const firstInvalid = controls.find((control) => !control.checkValidity());
    if (!firstInvalid) return true;
    const field = firstInvalid.name as FieldName;
    setErrors({ [field]: t("fieldError") });
    firstInvalid.focus();
    return false;
  }

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving || !validateVisibleFields(event.currentTarget)) return;
    setIsSaving(true);
    setErrors({});
    setStatus(null);
    void saveConfiguration({
      libraryId,
      expectedEditVersion: editVersion,
      sections: configuration,
    })
      .then((result) => {
        setEditVersion(result.editVersion);
        setSavedConfiguration(cloneConfiguration(configuration));
        setStatus({ message: t("saved"), result: "save-success" });
      })
      .catch((error: unknown) => {
        const field = fieldFromError(error);
        if (field) {
          setErrors({ [field]: t("fieldError") });
          focusField(field);
        }
        setStatus({ message: t("saveError"), result: "save-error" });
      })
      .finally(() => setIsSaving(false));
  }

  function handleActivate() {
    if (isActivating) return;
    setIsActivating(true);
    setErrors({});
    setStatus(null);
    void activateConfiguration({ libraryId, expectedEditVersion: editVersion })
      .then((result) => {
        setEditVersion(result.editVersion);
        if (result.kind === "setup") {
          const search = new URLSearchParams({ libraryId });
          router.push(`/evidence-libraries/new?${search.toString()}`);
          return;
        }
        setStatus({
          message: t("redeploymentQueued"),
          result: "activation-success",
        });
      })
      .catch((error: unknown) => {
        const field = fieldFromError(error);
        if (field) {
          setErrors({ [field]: t("fieldError") });
          focusField(field);
        }
        setStatus({
          message: t("activationError"),
          result: "activation-error",
        });
      })
      .finally(() => setIsActivating(false));
  }

  return (
    <>
      <form
        ref={formRef}
        noValidate
        onSubmit={handleSave}
        className="space-y-6"
      >
        <Card>
          <CardHeader>
            <CardTitle>{t("identityTitle")}</CardTitle>
            <CardDescription>{t("identityDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="configuration-library-name">
                {t("libraryNameLabel")}
              </Label>
              <Input
                id="configuration-library-name"
                name="name"
                value={configuration.identity.name}
                minLength={formContract.fields.name.minLength}
                maxLength={formContract.fields.name.maxLength}
                required
                aria-invalid={Boolean(errors.name)}
                aria-describedby={
                  errors.name ? "configuration-name-error" : undefined
                }
                onChange={(event) => {
                  clearError("name");
                  setConfiguration((current) => ({
                    ...current,
                    identity: { ...current.identity, name: event.target.value },
                  }));
                }}
              />
              <FieldError id="configuration-name-error" message={errors.name} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="configuration-library-short-name">
                {t("shortNameLabel")}
              </Label>
              <Input
                id="configuration-library-short-name"
                name="shortName"
                value={configuration.identity.shortName}
                minLength={formContract.fields.shortName.minLength}
                maxLength={formContract.fields.shortName.maxLength}
                required
                aria-invalid={Boolean(errors.shortName)}
                aria-describedby={
                  errors.shortName
                    ? "configuration-short-name-error"
                    : undefined
                }
                onChange={(event) => {
                  clearError("shortName");
                  setConfiguration((current) => ({
                    ...current,
                    identity: {
                      ...current.identity,
                      shortName: event.target.value,
                    },
                  }));
                }}
              />
              <FieldError
                id="configuration-short-name-error"
                message={errors.shortName}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="configuration-library-address">
                {t("publicAddressLabel")}
              </Label>
              <Input
                id="configuration-library-address"
                value={configuration.identity.baseUrl}
                readOnly
                aria-describedby="configuration-library-address-help"
              />
              <p
                id="configuration-library-address-help"
                className="text-sm text-muted-foreground"
              >
                {t("publicAddressHelp")}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("brandingTitle")}</CardTitle>
            <CardDescription>{t("brandingDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="configuration-logo">{t("logoLabel")}</Label>
              <Input
                id="configuration-logo"
                name="logo"
                type="url"
                value={configuration.identity.assets.logoDark}
                minLength={formContract.fields.logo.minLength}
                maxLength={formContract.fields.logo.maxLength}
                required
                aria-invalid={Boolean(errors.logo)}
                aria-describedby={
                  errors.logo ? "configuration-logo-error" : undefined
                }
                onChange={(event) => {
                  clearError("logo");
                  setConfiguration((current) => ({
                    ...current,
                    identity: {
                      ...current.identity,
                      assets: {
                        ...current.identity.assets,
                        logoDark: event.target.value,
                      },
                    },
                  }));
                }}
              />
              <FieldError id="configuration-logo-error" message={errors.logo} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="configuration-favicon">{t("faviconLabel")}</Label>
              <Input
                id="configuration-favicon"
                name="favicon"
                type="url"
                value={configuration.identity.assets.favicon}
                minLength={formContract.fields.favicon.minLength}
                maxLength={formContract.fields.favicon.maxLength}
                required
                aria-invalid={Boolean(errors.favicon)}
                aria-describedby={
                  errors.favicon ? "configuration-favicon-error" : undefined
                }
                onChange={(event) => {
                  clearError("favicon");
                  setConfiguration((current) => ({
                    ...current,
                    identity: {
                      ...current.identity,
                      assets: {
                        ...current.identity.assets,
                        favicon: event.target.value,
                      },
                    },
                  }));
                }}
              />
              <FieldError
                id="configuration-favicon-error"
                message={errors.favicon}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="configuration-accent-colour">
                {t("accentColourLabel")}
              </Label>
              <Input
                id="configuration-accent-colour"
                name="accent"
                value={configuration.theme.colors.accent}
                pattern={formContract.fields.colour.pattern}
                required
                aria-invalid={Boolean(errors.accent)}
                aria-describedby={
                  errors.accent ? "configuration-accent-error" : undefined
                }
                onChange={(event) => {
                  clearError("accent");
                  setConfiguration((current) => ({
                    ...current,
                    theme: {
                      colors: {
                        ...current.theme.colors,
                        accent: event.target.value,
                      },
                    },
                  }));
                }}
              />
              <FieldError
                id="configuration-accent-error"
                message={errors.accent}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="configuration-secondary-colour">
                {t("secondaryColourLabel")}
              </Label>
              <Input
                id="configuration-secondary-colour"
                name="tertiary"
                value={configuration.theme.colors.tertiary}
                pattern={formContract.fields.colour.pattern}
                required
                aria-invalid={Boolean(errors.tertiary)}
                aria-describedby={
                  errors.tertiary ? "configuration-tertiary-error" : undefined
                }
                onChange={(event) => {
                  clearError("tertiary");
                  setConfiguration((current) => ({
                    ...current,
                    theme: {
                      colors: {
                        ...current.theme.colors,
                        tertiary: event.target.value,
                      },
                    },
                  }));
                }}
              />
              <FieldError
                id="configuration-tertiary-error"
                message={errors.tertiary}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("languagesTitle")}</CardTitle>
            <CardDescription>{t("languagesDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="configuration-available-languages">
                {t("availableLanguagesLabel")}
              </Label>
              <select
                id="configuration-available-languages"
                name="availableLanguages"
                multiple
                required
                value={configuration.localization.locales}
                aria-invalid={Boolean(errors.availableLanguages)}
                aria-describedby={
                  errors.availableLanguages
                    ? "configuration-available-languages-help configuration-available-languages-error"
                    : "configuration-available-languages-help"
                }
                className="min-h-36 w-full rounded-md border bg-background px-3 py-2 text-sm"
                onChange={(event) => {
                  clearError("availableLanguages");
                  const selected = Array.from(
                    event.currentTarget.selectedOptions,
                    (option) => option.value,
                  );
                  setConfiguration((current) => ({
                    ...current,
                    localization: {
                      locales: selected,
                      defaultLocale: selected.includes(
                        current.localization.defaultLocale,
                      )
                        ? current.localization.defaultLocale
                        : (selected[0] ?? ""),
                    },
                  }));
                }}
              >
                {formContract.locales.map((locale) => (
                  <option key={locale} value={locale}>
                    {locale}
                  </option>
                ))}
              </select>
              <p
                id="configuration-available-languages-help"
                className="text-sm text-muted-foreground"
              >
                {t("availableLanguagesHelp")}
              </p>
              <FieldError
                id="configuration-available-languages-error"
                message={errors.availableLanguages}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="configuration-default-language">
                {t("defaultLanguageLabel")}
              </Label>
              <select
                id="configuration-default-language"
                name="defaultLanguage"
                value={configuration.localization.defaultLocale}
                required
                aria-invalid={Boolean(errors.defaultLanguage)}
                aria-describedby={
                  errors.defaultLanguage
                    ? "configuration-default-language-error"
                    : undefined
                }
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                onChange={(event) => {
                  clearError("defaultLanguage");
                  setConfiguration((current) => ({
                    ...current,
                    localization: {
                      ...current.localization,
                      defaultLocale: event.target.value,
                    },
                  }));
                }}
              >
                {configuration.localization.locales.map((locale) => (
                  <option key={locale} value={locale}>
                    {locale}
                  </option>
                ))}
              </select>
              <FieldError
                id="configuration-default-language-error"
                message={errors.defaultLanguage}
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-wrap justify-end gap-3 border-t pt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPreviewOpen(true)}
            >
              {t("preview")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isActivating}
              onClick={handleActivate}
            >
              {isActivating ? t("activating") : t("activate")}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? t("saving") : t("save")}
            </Button>
          </CardFooter>
        </Card>
        {status ? (
          <p
            role="status"
            data-result={status.result}
            className="text-sm text-muted-foreground"
          >
            {status.message}
          </p>
        ) : null}
      </form>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("previewTitle")}</DialogTitle>
            <DialogDescription>{t("previewDescription")}</DialogDescription>
          </DialogHeader>
          <SavedConfigurationPreview configuration={savedConfiguration} />
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </>
  );
}

export function EvidenceLibraryConfigurationShell({
  formContract,
  libraryId,
}: {
  formContract: EssentialConfigurationFormContract;
  libraryId: string;
}) {
  const t = useTranslations("evidenceLibraryConfigurationShell");
  const draftQuery = useProtectedQuery(api.evidenceLibraries.queries.getDraft, {
    libraryId: libraryId as Id<"evidenceLibraries">,
  });

  if (draftQuery.data === undefined) {
    return <AuthStatePanel variant="loading" loadingStyle="spinner" />;
  }

  const { draft, sections } = draftQuery.data;
  const initialConfiguration = readInitialConfiguration(
    sections,
    formContract.locales,
  );

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:py-14">
      <header className="mb-8 space-y-2">
        <p className="text-sm font-medium text-primary">{t("eyebrow")}</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {initialConfiguration.identity.name}
        </h1>
        <p className="max-w-2xl text-muted-foreground">{t("description")}</p>
      </header>
      <EssentialConfigurationForm
        key={draft._id}
        formContract={formContract}
        initialConfiguration={initialConfiguration}
        initialEditVersion={draft.editVersion}
        libraryId={libraryId as Id<"evidenceLibraries">}
      />
    </main>
  );
}
