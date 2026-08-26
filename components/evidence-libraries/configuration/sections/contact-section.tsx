"use client";

import { Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
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
import { FieldGroup, Panel, TextUploadField } from "../fields";
import { SectionShell, type SectionProps } from "../section-shell";

type LegalKind = LegalSource["kind"];
const LEGAL_KINDS: LegalKind[] = ["none", "text", "url"];

export function ContactSection({ draft, saved, patch, reset }: SectionProps) {
  const t = useTranslations("evidenceLibraryConfiguration.contact");
  const tf = useTranslations("evidenceLibraryConfiguration.fields");
  const { contact, email, legal } = draft;
  /** "Upload a file" chosen but nothing uploaded yet. The draft stays "none" until text lands. */
  const [pendingText, setPendingText] = useState<Record<LegalKey, boolean>>({
    privacy: false,
    cookie: false,
    terms: false,
  });

  const setContact = <K extends keyof ContactDraft>(key: K, value: string) =>
    patch((d) => {
      d.contact[key] = value;
      return d;
    });
  const setEmail = <K extends keyof EmailDraft>(key: K, value: string) =>
    patch((d) => {
      d.email[key] = value;
      return d;
    });
  const setLegal = (key: LegalKey, value: LegalSource) =>
    patch((d) => {
      d.legal[key] = value;
      return d;
    });

  /** Switching the source clears the other value. */
  const chooseKind = (key: LegalKey, kind: LegalKind) => {
    setPendingText((p) => ({ ...p, [key]: kind === "text" }));
    setLegal(key, kind === "url" ? { kind: "url", url: "" } : { kind: "none" });
  };

  const emailError = (value: string) => (value && !EMAIL.test(value) ? t("emailError") : null);

  return (
    <SectionShell
      sectionKey="contact"
      icon={Mail}
      description={t("description")}
      draft={draft}
      saved={saved}
      reset={reset}
    >
      <FieldGroup title={t("contactHeading")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("email")} hint={t("emailHint")} error={emailError(contact.email)}>
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
            error={contact.phone && !PHONE.test(contact.phone) ? t("phoneError") : null}
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

      <FieldGroup title={t("recipientsHeading")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t("contactRecipient")}
            hint={t("contactRecipientHint")}
            error={emailError(email.contactRecipient)}
          >
            {(id, invalid) => (
              <Input
                id={id}
                type="email"
                className="bg-background"
                value={email.contactRecipient}
                placeholder={contact.email || t("contactRecipientPlaceholder")}
                aria-invalid={invalid || undefined}
                onChange={(e) => setEmail("contactRecipient", e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t("takedownRecipient")}
            hint={t("takedownRecipientHint")}
            error={
              !email.takedownRecipient.trim()
                ? t("takedownRequired")
                : emailError(email.takedownRecipient)
            }
          >
            {(id, invalid) => (
              <Input
                id={id}
                type="email"
                className="bg-background"
                value={email.takedownRecipient}
                placeholder="takedown@example.org"
                aria-invalid={invalid || undefined}
                onChange={(e) => setEmail("takedownRecipient", e.target.value)}
              />
            )}
          </Field>
        </div>
      </FieldGroup>

      <FieldGroup title={t("legalHeading")} hint={t("legalHint")}>
        {LEGAL_KEYS.map((key) => {
          const source = legal[key];
          const shownKind: LegalKind =
            source.kind === "none" && pendingText[key] ? "text" : source.kind;
          return (
            <Panel
              key={key}
              tone="plain"
              className="space-y-3"
              data-legal={key}
              data-legal-kind={shownKind}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{t(`legal.${key}`)}</p>
                <Tabs
                  value={shownKind}
                  onValueChange={(kind) => chooseKind(key, kind as LegalKind)}
                >
                  <TabsList aria-label={t("legalSourceLabel", { page: t(`legal.${key}`) })}>
                    {LEGAL_KINDS.map((kind) => (
                      <TabsTrigger key={kind} value={kind}>
                        {t(`legalKinds.${kind}`)}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
              {shownKind === "text" ? (
                <TextUploadField
                  label={t("legalFile")}
                  required
                  value={source.kind === "text" ? source.text : null}
                  onChange={(text) => {
                    setPendingText((p) => ({ ...p, [key]: !text }));
                    setLegal(key, text ? { kind: "text", text } : { kind: "none" });
                  }}
                />
              ) : null}
              {source.kind === "url" ? (
                <Field
                  label={t("legalUrl")}
                  error={!HTTPS_URL.test(source.url) ? t("legalUrlError") : null}
                >
                  {(id, invalid) => (
                    <Input
                      id={id}
                      className="bg-background font-mono text-sm"
                      value={source.url}
                      inputMode="url"
                      placeholder="https://"
                      aria-invalid={invalid || undefined}
                      onChange={(e) => setLegal(key, { kind: "url", url: e.target.value })}
                    />
                  )}
                </Field>
              ) : null}
              {shownKind === "none" ? (
                <p className="text-xs text-muted-foreground">{t("legalNone")}</p>
              ) : null}
            </Panel>
          );
        })}
      </FieldGroup>
    </SectionShell>
  );
}
