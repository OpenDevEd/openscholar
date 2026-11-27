"use client";

import { useState } from "react";
import { ZenodoMark } from "@/components/icons/zenodo-mark";
import { useConnectZenodo, useZenodoAccount } from "@/lib/zenodo/account";
import { useTranslations, useFormatter } from "next-intl";
import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import { PersonIcon, ShieldCheck, PublishIcon } from "@/components/icons";
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
import { COMMON_ZENODO_LICENCES, ZENODO_LICENCES, isZenodoLicence, licenceShortName, zenodoLicenceTitle } from "@/lib/zenodo-licences";
import { FieldGroup, PanelRow } from "../fields";
import { DocidAccount } from "./docid-account";
import { CredentialMode, type ActiveMode } from "./credential-mode";

/**
 * Zenodo's licences as picker rows, the common ones first. A Creative Commons licence goes by its short name with its
 * full title beneath, as the community admin's Licence field shows it: the six common titles all start "Creative Commons
 * Attribution", so cut to a phone's field they read the same. Any other goes by its title with its id beneath.
 */
const licenceOption = (id: string, group: string): PickerOption => {
  const short = licenceShortName(id);
  return { id, name: short ?? zenodoLicenceTitle(id), detail: short ? zenodoLicenceTitle(id) : id, group };
};
const licenceOptions = (common: string, all: string): PickerOption[] => [
  ...COMMON_ZENODO_LICENCES.map((id) => licenceOption(id, common)),
  ...ZENODO_LICENCES.filter(([id]) => !(COMMON_ZENODO_LICENCES as readonly string[]).includes(id)).map(([id]) => licenceOption(id, all)),
];

type Saved = FunctionReturnType<
  typeof api.evidenceLibraries.publicationProviders.get
>;

/** Zenodo's licences that don't let anyone share the work: their records' files are never public on Zenodo. */
const CLOSED_ZENODO_LICENCES = new Set(["other-closed", "zenodo-freetoread-1.0"]);

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
          fileAccess
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
/**
 * A community's own Zenodo account (#1237): the one its admin connected on Settings > Connections, where its records
 * are archived under its name, keeping the community's Crossref DOI. A community without its own Crossref credentials
 * (off, or the sandbox) can't use it: its records would carry no DOI, or a test one.
 */
function OwnZenodoAccount({ testCrossref }: { testCrossref: boolean }) {
  const t = useTranslations("publicationSettings");
  const account = useZenodoAccount();
  const connect = useConnectZenodo();
  const usable = account && !account.broken ? account : null;
  if (testCrossref)
    return (
      <PanelRow
        title={t("accountSandbox")}
        // Where its own Crossref account comes from, the one thing it still needs: in the text, which keeps the row's
        // width on a phone instead of a narrow column beside a link.
        hint={
          <>
            {t("accountSandboxHint")}{" "}
            <a className="text-primary hover:underline" href="https://www.crossref.org/membership/" target="_blank" rel="noreferrer">
              {t("accountCrossrefJoin")}
            </a>
            {/* The account it would use is said too: without it, an owner went to Settings to see whether one was connected. */}
            {usable ? (
              <span className="mt-1 flex min-w-0 items-center gap-1">
                <PersonIcon className="size-3 shrink-0" />
                <span className="truncate">{t("accountConnectedAs", { name: usable.name ?? "Zenodo" })}</span>
              </span>
            ) : null}
          </>
        }
        leading={<ZenodoMark className="size-8 rounded-lg opacity-60" />}
      />
    );
  return usable ? (
    <PanelRow
      title={usable.name ?? "Zenodo"}
      hint={t("accountHint")}
      leading={<ZenodoMark className="size-8 rounded-lg" />}
      action={
        <a className="text-xs text-primary hover:underline" href="/settings/connections">
          {t("accountManage")}
        </a>
      }
    />
  ) : (
    <PanelRow
      title={t("accountNone")}
      hint={t(account?.broken ? "accountBroken" : "accountNoneHint")}
      leading={<ZenodoMark className="size-8 rounded-lg" />}
      action={
        // A window of its own, so the settings typed here stay as they are while Zenodo is connected.
        <Button size="sm" type="button" onClick={() => void connect(window.location.pathname + window.location.search, { window: true })}>
          {t("accountConnect")}
        </Button>
      }
    />
  );
}

export function PublicationForm({
  saved,
  disabled = false,
  onSave,
  words,
  fileAccess = false,
  docid = false,
}: {
  /** Openscholar Reports' form: its DOCiD account too. Communities show the DOCiDs their records come with and never register one. */
  docid?: boolean;
  saved: Saved;
  disabled?: boolean;
  /** A community's form: who gets its new records' files is set beside their licence. Reports choose per report. */
  fileAccess?: boolean;
  /** Verifies the accounts and saves; a refusal's `message` is shown under the form. */
  onSave: (input: {
    settings: PublicationSettings;
    credentials: PublicationSecrets;
    expectedUpdatedAt: number | null;
  }) => Promise<unknown>;
  /** What differs from a community's wording, where the form isn't a community's. */
  words?: { zenodoHint?: string; crossrefHint?: string; namespaceHint?: string; namespacePlaceholder?: string; savedHint?: string };
}) {
  const t = useTranslations("publicationSettings");
  const format = useFormatter();
  const [settings, setSettings] = useState(saved.settings);
  // Who gets the files of a community's new records: what its licence allows of what was saved (the field below).
  const openFiles = !CLOSED_ZENODO_LICENCES.has(settings.zenodo.license);
  const savedFiles = settings.zenodo.defaultFileAccess ?? "open";
  const fileValue = openFiles ? (savedFiles === "readers" ? "open" : savedFiles) : savedFiles === "open" ? "private" : savedFiles;
  const [credentials, setCredentials] = useState<PublicationSecrets>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A refusal is about the settings it was given: any change leaves it behind, so it never stays over ones it isn't about.
  const change: typeof setSettings = (next) => {
    setError(null);
    setSettings(next);
  };
  const zenodo = settings.zenodo.mode !== "off";
  const crossref = settings.crossref.mode !== "off";
  const dirty =
    JSON.stringify(settings) !== JSON.stringify(saved.settings) ||
    Object.values(credentials).some(Boolean);
  const updateZenodo = (patch: Partial<PublicationSettings["zenodo"]>) =>
    change((current) => ({
      ...current,
      zenodo: { ...current.zenodo, ...patch },
    }));
  const updateCrossref = (patch: Partial<PublicationSettings["crossref"]>) =>
    change((current) => ({
      ...current,
      crossref: { ...current.crossref, ...patch },
    }));
  const credential = (key: keyof PublicationSecrets, value: string) => {
    setError(null);
    setCredentials((current) => ({ ...current, [key]: value }));
  };
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
          hint={crossref ? t("zenodoRequired") : (words?.zenodoHint ?? t("zenodoHint"))}
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
              <CredentialMode<ActiveMode | "own">
                provider="Zenodo"
                value={settings.zenodo.mode as ActiveMode | "own"}
                onChange={(mode) => updateZenodo({ mode })}
                own={fileAccess ? <OwnZenodoAccount testCrossref={settings.crossref.mode !== "custom"} /> : undefined}
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
                {/* Who gets the files of records made here, as the licence allows: an open one lets them go to anyone or
                    the editors only, one that isn't keeps them private on Zenodo and lets readers here have them or not.
                    Its hint says what the choice means for readers first: "Editors only" beside an open licence read as a
                    contradiction to a community admin who walked it. */}
                {fileAccess ? <Field label={t("fileAccess")} hint={`${t(`fileAccessMeans_${fileValue}`)} ${t("fileAccessHint")}`}>
                  {(id) => (
                    <Select value={fileValue} onValueChange={(mode) => updateZenodo({ defaultFileAccess: mode as "open" | "private" | "readers" })}>
                      <SelectTrigger id={id} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(openFiles ? (["open", "private"] as const) : (["readers", "private"] as const)).map((mode) => (
                          <SelectItem key={mode} value={mode}>
                            {t(`fileAccess_${mode}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Field> : null}
                {/* A copy in the community's own account always keeps its Crossref DOI. */}
                {settings.zenodo.mode !== "own" && (
                  <Field label={t("archiveDoi")} hint={t("archiveDoiHint")}>
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
                )}
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
                change((current) => ({
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
        {docid ? (
          <DocidAccount
            docid={settings.docid}
            onChange={(next) => change((current) => ({ ...current, docid: next }))}
            password={credentials.docidPassword ?? ""}
            onPassword={(value) => credential("docidPassword", value)}
            stored={!!saved.custom.docidPassword}
            keptEmail={saved.custom.docidEmail}
          />
        ) : null}
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
