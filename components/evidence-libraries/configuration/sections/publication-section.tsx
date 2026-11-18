"use client";

import { useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import { FlaskConical, KeyRound, ShieldCheck, PublishIcon } from "@/components/icons";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type {
  PublicationSettings,
  PublicationSecrets,
} from "@/convex/evidenceLibraries/publicationValidators";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useWithPage } from "../preloads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Field, FieldError, SectionCard } from "../section-card";
import { OptionSelect, type PickerOption } from "@/components/shared/option-picker";
import { COMMON_ZENODO_LICENCES, ZENODO_LICENCES, isZenodoLicence, zenodoLicenceTitle } from "@/lib/zenodo-licences";
import { FieldGroup, PanelRow } from "../fields";

/** Zenodo's licences as picker rows: the common ones first, then every one, each with its id beneath its title. */
const licenceOptions = (common: string, all: string): PickerOption[] => [
  ...COMMON_ZENODO_LICENCES.map((id) => ({ id, name: zenodoLicenceTitle(id), detail: id, group: common })),
  ...ZENODO_LICENCES.filter(([id]) => !(COMMON_ZENODO_LICENCES as readonly string[]).includes(id)).map(([id, name]) => ({ id, name, detail: id, group: all })),
];

type Saved = FunctionReturnType<
  typeof api.evidenceLibraries.publicationProviders.get
>;
type ActiveMode = "sandbox" | "custom";

function CredentialMode({
  provider,
  value,
  onChange,
  children,
}: {
  provider: string;
  value: ActiveMode;
  onChange: (mode: ActiveMode) => void;
  children: React.ReactNode;
}) {
  const t = useTranslations("publicationSettings");
  return (
    <Tabs
      value={value}
      onValueChange={(mode) => onChange(mode as ActiveMode)}
      className="gap-4"
    >
      <TabsList aria-label={t("credentials", { provider })}>
        <TabsTrigger value="sandbox">
          <FlaskConical />
          {t("sandbox")}
        </TabsTrigger>
        <TabsTrigger value="custom">
          <KeyRound />
          {t("custom")}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="sandbox">
        <PanelRow
          title={t("sandboxTitle")}
          hint={t("sandboxHint")}
          leading={<FlaskConical className="size-4 text-muted-foreground" />}
        />
      </TabsContent>
      <TabsContent value="custom">{children}</TabsContent>
    </Tabs>
  );
}

export function PublicationSection({
  libraryId,
  operationRunning,
}: {
  libraryId: Id<"evidenceLibraries">;
  operationRunning: boolean;
}) {
  const t = useTranslations("publicationSettings");
  const data = useWithPage<typeof api.evidenceLibraries.publicationProviders.get>("publication", useProtectedQuery(
    api.evidenceLibraries.publicationProviders.get,
    { libraryId },
  ).data);
  const save = useAction(
    api.evidenceLibraries.publicationProviderActions.verifyAndSave,
  );
  return (
    <SectionCard
      id="sec-publication"
      icon={PublishIcon}
      title={t("title")}
      description={t("description")}
    >
      {data ? (
        <PublicationForm
          key={`${libraryId}:${data.updatedAt}`}
          saved={data}
          disabled={operationRunning}
          onSave={(input) => save({ libraryId, ...input })}
        />
      ) : (
        <div className="flex h-5 items-center">
          <Spinner className="size-4" aria-label={t("loading")} />
        </div>
      )}
    </SectionCard>
  );
}

/**
 * The Zenodo and Crossref accounts a publisher registers DOIs with: a community here, and Openscholar Reports on
 * the admin's Publishing page. A community's Crossref can't be on without Zenodo, which archives every file.
 */
export function PublicationForm({
  saved,
  disabled = false,
  onSave,
  words,
  crossrefAlone = false,
}: {
  saved: Saved;
  disabled?: boolean;
  /** Verifies the accounts and saves; a refusal's `message` is shown under the form. */
  onSave: (input: {
    settings: PublicationSettings;
    credentials: PublicationSecrets;
    expectedUpdatedAt: number | null;
  }) => Promise<unknown>;
  /** What differs from a community's wording, where the form isn't a community's. */
  words?: { zenodoHint?: string; crossrefHint?: string; namespaceHint?: string; namespacePlaceholder?: string; savedHint?: string };
  /** Crossref may be on without Zenodo. A community's runtime refuses that; Openscholar Reports chooses. */
  crossrefAlone?: boolean;
}) {
  const t = useTranslations("publicationSettings");
  const format = useFormatter();
  const [settings, setSettings] = useState(saved.settings);
  const [credentials, setCredentials] = useState<PublicationSecrets>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zenodo = settings.zenodo.mode !== "off";
  const crossref = settings.crossref.mode !== "off";
  const dirty =
    JSON.stringify(settings) !== JSON.stringify(saved.settings) ||
    Object.values(credentials).some(Boolean);
  const updateZenodo = (patch: Partial<PublicationSettings["zenodo"]>) =>
    setSettings((current) => ({
      ...current,
      zenodo: { ...current.zenodo, ...patch },
    }));
  const updateCrossref = (patch: Partial<PublicationSettings["crossref"]>) =>
    setSettings((current) => ({
      ...current,
      crossref: { ...current.crossref, ...patch },
    }));
  const credential = (key: keyof PublicationSecrets, value: string) =>
    setCredentials((current) => ({ ...current, [key]: value }));
  const storedHint = saved.updatedAt ? t("storedHint") : undefined;
  async function verify() {
    if (busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({
        settings,
        credentials,
        expectedUpdatedAt: saved.updatedAt,
      });
      toast.success(t("saved"), {
        description: words?.savedHint ?? t("activateHint"),
      });
    } catch (error) {
      const detail =
        error instanceof ConvexError && typeof error.data === "object"
          ? error.data?.message
          : null;
      setError(typeof detail === "string" ? detail : t("failure"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <fieldset
        disabled={busy || disabled}
        className="min-w-0 space-y-5 disabled:opacity-60"
      >
        <FieldGroup
          title={
            <span className="inline-flex items-center gap-2">
              <img src="/brands/zenodo.svg" alt="Zenodo" className="h-7 w-auto" />
            </span>
          }
          hint={crossref && !crossrefAlone ? t("zenodoRequired") : (words?.zenodoHint ?? t("zenodoHint"))}
          action={
            <Switch
              aria-label={t("enableZenodo")}
              checked={zenodo}
              disabled={crossref && !crossrefAlone}
              onCheckedChange={(enabled) =>
                updateZenodo({ mode: enabled ? "sandbox" : "off" })
              }
            />
          }
        >
          {zenodo && (
            <>
              <CredentialMode
                provider="Zenodo"
                value={settings.zenodo.mode as ActiveMode}
                onChange={(mode) => updateZenodo({ mode })}
              >
                <Field label={t("token")} hint={t("tokenHint")}>
                  {(id) => (
                    <Input
                      id={id}
                      type="password"
                      autoComplete="new-password"
                      value={credentials.zenodoToken ?? ""}
                      placeholder={
                        saved.custom.zenodoToken
                          ? storedHint
                          : undefined
                      }
                      onChange={(e) =>
                        credential("zenodoToken", e.target.value)
                      }
                    />
                  )}
                </Field>
                <a
                  className="mt-2 inline-block text-xs text-primary hover:underline"
                  href="https://zenodo.org/account/settings/applications/tokens/new/"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("createToken")}
                </a>
              </CredentialMode>
              {/* One column set on a phone too: an implicit column grows to the picker's licence name on one line, and
                  at 200% text that ran the field 703px wide on a 390px phone. */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Zenodo refuses any licence outside its own list, so the list is all that can be picked. A licence
                    saved before this was a picker, and isn't on it, still shows, marked, until another is picked. */}
                <Field label={t("license")} hint={isZenodoLicence(settings.zenodo.license) ? t("licenseHint") : t("licenseUnknown")}>
                  {(id) => (
                    <OptionSelect
                      id={id}
                      label={t("license")}
                      value={settings.zenodo.license}
                      invalid={!isZenodoLicence(settings.zenodo.license)}
                      options={licenceOptions(t("licenseCommon"), t("licenseAll"))}
                      searchPlaceholder={t("licenseSearch")}
                      emptyText={t("licenseNone")}
                      onChange={(license) => updateZenodo({ license })}
                    />
                  )}
                </Field>
                <Field label={t("archiveDoi")}>
                  {(id) => (
                    <Select
                      value={settings.zenodo.defaultIdentifierPolicy}
                      onValueChange={(value) =>
                        updateZenodo({
                          defaultIdentifierPolicy: value as
                            | "mint-zenodo"
                            | "reuse-crossref",
                        })
                      }
                    >
                      <SelectTrigger id={id} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mint-zenodo">
                          {t("zenodoDoi")}
                        </SelectItem>
                        {crossref && (
                          <SelectItem value="reuse-crossref">
                            {t("crossrefDoi")}
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  )}
                </Field>
              </div>
            </>
          )}
        </FieldGroup>
        <FieldGroup
          title={
            <span className="inline-flex items-center gap-2">
              <img
                src="/brands/crossref.svg"
                alt="Crossref"
                className="h-7 w-auto rounded bg-white p-0.5"
              />
            </span>
          }
          hint={words?.crossrefHint ?? t("crossrefHint")}
          action={
            <Switch
              aria-label={t("enableCrossref")}
              checked={crossref}
              onCheckedChange={(enabled) =>
                setSettings((current) => ({
                  ...current,
                  crossref: {
                    ...current.crossref,
                    mode: enabled ? "sandbox" : "off",
                  },
                  zenodo: {
                    ...current.zenodo,
                    mode:
                      enabled && current.zenodo.mode === "off" && !crossrefAlone
                        ? "sandbox"
                        : current.zenodo.mode,
                    defaultIdentifierPolicy: enabled
                      ? current.zenodo.defaultIdentifierPolicy
                      : "mint-zenodo",
                  },
                }))
              }
            />
          }
        >
          {crossref && (
            <>
              <CredentialMode
                provider="Crossref"
                value={settings.crossref.mode as ActiveMode}
                onChange={(mode) => {
                  // The own account's details come back as they were kept; a first switch starts them empty.
                  updateCrossref({
                    mode,
                    ...(mode === "custom"
                      ? (saved.custom.crossref ?? {
                          prefix: "",
                          registrant: "",
                          depositorName: "",
                          email: "",
                        })
                      : {}),
                  });
                  if (mode === "custom" && settings.zenodo.mode === "sandbox")
                    updateZenodo({ mode: "custom" });
                }}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("login")} hint={t("loginHint")}>
                    {(id) => (
                      <Input
                        id={id}
                        autoComplete="off"
                        value={credentials.crossrefLoginId ?? ""}
                        placeholder={
                          saved.custom.crossrefLogin
                            ? storedHint
                            : "name@example.org/role"
                        }
                        onChange={(e) =>
                          credential("crossrefLoginId", e.target.value)
                        }
                      />
                    )}
                  </Field>
                  <Field label={t("password")}>
                    {(id) => (
                      <Input
                        id={id}
                        type="password"
                        autoComplete="new-password"
                        value={credentials.crossrefPassword ?? ""}
                        placeholder={
                          saved.custom.crossrefLogin
                            ? storedHint
                            : undefined
                        }
                        onChange={(e) =>
                          credential("crossrefPassword", e.target.value)
                        }
                      />
                    )}
                  </Field>
                  {(
                    [
                      ["prefix", t("prefix")],
                      ["registrant", t("registrant")],
                      ["depositorName", t("depositorName")],
                      ["email", t("email")],
                    ] as const
                  ).map(([key, label]) =>
                    key === "registrant" ? (
                      // Crossref's own name for the prefix, read when the form is saved: a prefix typed since has none yet.
                      <Field key={key} label={label} hint={t("registrantHint")}>
                        {(id) => (
                          <Input
                            id={id}
                            readOnly
                            className="bg-muted/50 text-muted-foreground"
                            value={settings.crossref.registrant}
                          />
                        )}
                      </Field>
                    ) : (
                      <Field key={key} label={label}>
                        {(id) => (
                          <Input
                            id={id}
                            type={key === "email" ? "email" : "text"}
                            value={settings.crossref[key]}
                            onChange={(e) =>
                              updateCrossref(key === "prefix" ? { prefix: e.target.value, registrant: "" } : { [key]: e.target.value })
                            }
                          />
                        )}
                      </Field>
                    ),
                  )}
                </div>
              </CredentialMode>
              <Field label={t("namespace")} hint={words?.namespaceHint ?? t("namespaceHint")}>
                {(id) => (
                  <Input
                    id={id}
                    value={settings.crossref.suffixNamespace}
                    placeholder={words?.namespacePlaceholder ?? t("libraryName")}
                    onChange={(e) =>
                      updateCrossref({ suffixNamespace: e.target.value })
                    }
                  />
                )}
              </Field>
            </>
          )}
        </FieldGroup>
      </fieldset>
      {error && <FieldError>{error}</FieldError>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-4">
        <p
          className="flex items-center gap-2 text-xs text-muted-foreground"
          role="status"
        >
          {busy ? (
            <>
              <Spinner className="size-4" />
              {t("checking")}
            </>
          ) : dirty ? (
            t("needsVerification")
          ) : saved.verifiedAt ? (
            <>
              <ShieldCheck className="size-4 ink-success" />
              {t("verified", {
                date: format.dateTime(saved.verifiedAt, {
                  dateStyle: "short",
                  timeStyle: "short",
                }),
              })}
            </>
          ) : (
            t("checkedBeforeSaving")
          )}
        </p>
        <Button
          size="sm"
          disabled={busy || disabled || (!dirty && !saved.updatedAt)}
          onClick={() => void verify()}
        >
          <ShieldCheck />
          {busy ? t("verifying") : t("verifySave")}
        </Button>
      </div>
    </>
  );
}
