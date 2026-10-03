"use client";

import { NotificationsFields } from "./notifications-fields";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { HTTPS_URL } from "@/lib/evidence-libraries/configuration/links";
import {
  type ContactDraft,
  EMAIL,
  type EmailDraft,
  LEGAL_KEYS,
  type LegalKey,
  type LegalSource,
  PHONE,
  SCHEMA_LIMITS,
} from "@/lib/evidence-libraries/configuration/rules";
import { Field } from "../section-card";
import { FieldGroup, Panel, TextUploadField, ToggleRow } from "../fields";
import { SectionShell, type SectionProps } from "../section-shell";
import { MailIcon } from "@/components/section-icons";

type LegalKind = LegalSource["kind"];
const LEGAL_KINDS: LegalKind[] = ["none", "text", "url"];
const RECIPIENT_KEYS = [
  "contactRecipient",
  "takedownRecipient",
] as const satisfies readonly (keyof EmailDraft)[];

export function ContactSection({ libraryId, draft, saved, patch, reset }: SectionProps) {
  const t = useTranslations("evidenceLibraryConfiguration.contact");
  const tf = useTranslations("evidenceLibraryConfiguration.fields");
  const { contact, email, legal } = draft;

  const setContact = <K extends keyof ContactDraft>(key: K, value: string) =>
    patch((d) => {
      d.contact[key] = value;
      return d;
    });
  const setEmail = <K extends keyof EmailDraft>(key: K, value: string | null) =>
    patch((d) => {
      d.email[key] = value;
      return d;
    });
  const setLegal = (key: LegalKey, value: LegalSource) =>
    patch((d) => {
      d.legal[key] = value;
      return d;
    });

  /** Switching the source clears the other value. Text stays empty until a file is uploaded. */
  const chooseKind = (key: LegalKey, kind: LegalKind) =>
    setLegal(
      key,
      kind === "url"
        ? { kind: "url", url: "" }
        : kind === "text"
          ? { kind: "text", text: "" }
          : { kind: "none" },
    );

  const emailError = (value: string) =>
    value && !EMAIL.test(value) ? t("emailError") : null;

  return (
    <SectionShell
      sectionKey="contact"
      icon={MailIcon}
      description={t("description")}
      draft={draft}
      saved={saved}
      reset={reset}
    >
      <FieldGroup title={t("contactHeading")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t("email")}
            hint={t("emailHint")}
            error={emailError(contact.email)}
          >
            {(id, invalid) => (
              <Input
                id={id}
                type="email"
                className="bg-background"
                value={contact.email}
                placeholder="hello@example.org"
                aria-invalid={invalid || undefined}
                onChange={(e) => setContact("email", e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t("phone")}
            hint={t("phoneHint")}
            suffix={tf("optional")}
            error={
              contact.phone && !PHONE.test(contact.phone)
                ? t("phoneError")
                : null
            }
          >
            {(id, invalid) => (
              <Input
                id={id}
                type="tel"
                className="bg-background font-mono text-sm"
                value={contact.phone}
                placeholder="+442012345678"
                aria-invalid={invalid || undefined}
                onChange={(e) => setContact("phone", e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field
          label={t("address")}
          hint={t("addressHint")}
          suffix={tf("optional")}
          counter={`${contact.address.length} / ${SCHEMA_LIMITS.contact.address}`}
        >
          {(id) => (
            <Textarea
              id={id}
              className="bg-background"
              rows={3}
              maxLength={SCHEMA_LIMITS.contact.address}
              value={contact.address}
              onChange={(e) => setContact("address", e.target.value)}
            />
          )}
        </Field>
      </FieldGroup>

      <FieldGroup title={t("recipientsHeading")} hint={t("recipientsHint")}>
        {RECIPIENT_KEYS.map((key) => {
          const value = email[key];
          return (
            <div
              key={key}
              className="space-y-3"
              data-recipient={key}
              data-enabled={value !== null}
            >
              <ToggleRow
                label={t(`${key}Label`)}
                hint={t(`${key}Hint`)}
                checked={value !== null}
                onChange={(on) => setEmail(key, on ? "" : null)}
              />
              {value !== null ? (
                <Panel tone="muted" className="ml-4">
                  <Field
                    label={t(`${key}`)}
                    className="max-w-sm"
                    error={!EMAIL.test(value) ? t("emailError") : null}
                  >
                    {(id, invalid) => (
                      <Input
                        id={id}
                        type="email"
                        className="bg-background"
                        value={value}
                        placeholder="name@example.org"
                        aria-invalid={invalid || undefined}
                        onChange={(e) => setEmail(key, e.target.value)}
                      />
                    )}
                  </Field>
                </Panel>
              ) : null}
            </div>
          );
        })}
      </FieldGroup>

      <NotificationsFields libraryId={libraryId} draft={draft} patch={patch} />

      <FieldGroup title={t("legalHeading")} hint={t("legalHint")}>
        {LEGAL_KEYS.map((key) => {
          const source = legal[key];
          return (
            <Panel
              key={key}
              tone="plain"
              className="space-y-3"
              data-legal={key}
              data-legal-kind={source.kind}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{t(`legal.${key}`)}</p>
                <Tabs
                  value={source.kind}
                  onValueChange={(kind) => chooseKind(key, kind as LegalKind)}
                >
                  <TabsList
                    aria-label={t("legalSourceLabel", {
                      page: t(`legal.${key}`),
                    })}
                  >
                    {LEGAL_KINDS.map((kind) => (
                      <TabsTrigger key={kind} value={kind}>
                        {kind === "none" && key !== "terms"
                          ? t("legalStandard")
                          : t(`legalKinds.${kind}`)}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
              {source.kind === "text" ? (
                <TextUploadField
                  label={t("legalFile")}
                  required
                  value={source.text || null}
                  onChange={(text) =>
                    setLegal(key, { kind: "text", text: text ?? "" })
                  }
                />
              ) : null}
              {source.kind === "url" ? (
                <Field
                  label={t("legalUrl")}
                  error={
                    !HTTPS_URL.test(source.url) ? t("legalUrlError") : null
                  }
                >
                  {(id, invalid) => (
                    <Input
                      id={id}
                      className="bg-background font-mono text-sm"
                      value={source.url}
                      inputMode="url"
                      placeholder="https://"
                      aria-invalid={invalid || undefined}
                      onChange={(e) =>
                        setLegal(key, { kind: "url", url: e.target.value })
                      }
                    />
                  )}
                </Field>
              ) : null}
              {source.kind === "none" ? (
                <p className="text-xs text-muted-foreground">
                  {t(key === "terms" ? "legalNoneTerms" : "legalNone")}
                </p>
              ) : null}
            </Panel>
          );
        })}
      </FieldGroup>
    </SectionShell>
  );
}
