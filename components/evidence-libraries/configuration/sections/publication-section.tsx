"use client";

import { useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import { FlaskConical, KeyRound, Send, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type {
  PublicationSettings,
  PublicationSecrets,
} from "@/convex/evidenceLibraries/publicationValidators";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
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
import { FieldGroup, PanelRow } from "../fields";

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
  const { data } = useProtectedQuery(
    api.evidenceLibraries.publicationProviders.get,
    { libraryId },
  );
  return (
    <SectionCard
      id="sec-publication"
      icon={Send}
      title={t("title")}
      description={t("description")}
    >
      {data ? (
        <PublicationForm
          key={`${libraryId}:${data.updatedAt}`}
          libraryId={libraryId}
          saved={data}
          disabled={operationRunning}
        />
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          {t("loading")}
        </div>
      )}
    </SectionCard>
  );
}

function PublicationForm({
  libraryId,
  saved,
  disabled,
}: {
  libraryId: Id<"evidenceLibraries">;
  saved: Saved;
  disabled: boolean;
}) {
  const t = useTranslations("publicationSettings");
  const format = useFormatter();
  const [settings, setSettings] = useState(saved.settings);
  const [credentials, setCredentials] = useState<PublicationSecrets>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useAction(
    api.evidenceLibraries.publicationProviderActions.verifyAndSave,
  );
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
      await save({
        libraryId,
        settings,
        credentials,
        expectedUpdatedAt: saved.updatedAt,
      });
      toast.success(t("saved"), {
        description: t("activateHint"),
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
              <img src="/brands/zenodo.svg" alt="" className="size-5" />
              Zenodo
            </span>
          }
          hint={crossref ? t("zenodoRequired") : t("zenodoHint")}
          action={
            <Switch
              aria-label={t("enableZenodo")}
              checked={zenodo}
              disabled={crossref}
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
                        saved.settings.zenodo.mode === "custom"
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
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("license")} hint={t("licenseHint")}>
                  {(id) => (
                    <Input
                      id={id}
                      value={settings.zenodo.license}
                      onChange={(e) =>
                        updateZenodo({ license: e.target.value })
                      }
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
                className="h-6 w-auto rounded bg-white p-0.5"
              />
            </span>
          }
          hint={t("crossrefHint")}
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
                      enabled && current.zenodo.mode === "off"
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
                  updateCrossref({
                    mode,
                    ...(mode === "custom"
                      ? {
                          prefix: "",
                          registrant: "",
                          depositorName: "",
                          email: "",
                        }
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
                          saved.settings.crossref.mode === "custom"
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
                          saved.settings.crossref.mode === "custom"
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
                  ).map(([key, label]) => (
                    <Field key={key} label={label}>
                      {(id) => (
                        <Input
                          id={id}
                          type={key === "email" ? "email" : "text"}
                          value={settings.crossref[key]}
                          onChange={(e) =>
                            updateCrossref({ [key]: e.target.value })
                          }
                        />
                      )}
                    </Field>
                  ))}
                </div>
              </CredentialMode>
              <Field label={t("namespace")} hint={t("namespaceHint")}>
                {(id) => (
                  <Input
                    id={id}
                    value={settings.crossref.suffixNamespace}
                    placeholder={t("libraryName")}
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
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-4">
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
              <ShieldCheck className="size-4 text-emerald-600" />
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
