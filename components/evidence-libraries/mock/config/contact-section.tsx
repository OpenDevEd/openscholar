"use client";

import { Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { LegalSource } from "@/lib/evidence-libraries/mock/config";
import { Field } from "../section-card";
import { FieldGroup, UploadField } from "./fields";
import { SectionShell, type SectionProps } from "./section-shell";

const LEGAL_KEYS = ["privacy", "cookie", "terms"] as const;
type LegalKey = (typeof LEGAL_KEYS)[number];
const ADDRESS_MAX_LINES = 8;

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isHttps = (v: string) => /^https:\/\/\S+$/.test(v);

type LegalKind = LegalSource["kind"];

export function ContactSection({ library, patch }: SectionProps) {
  const t = useTranslations("evidenceLibraryMock.config.contact");
  const contact = library.draft.contact;
  /** "Upload a file" chosen but no file uploaded yet. The draft stays "none" until a file lands. */
  const [pendingFile, setPendingFile] = useState<Record<LegalKey, boolean>>({
    privacy: false,
    cookie: false,
    terms: false,
  });

  const set = <K extends "email" | "phone" | "address" | "contactRecipient" | "takedownRecipient">(
    key: K,
    value: string,
  ) =>
    patch((d) => {
      d.contact[key] = value;
      return d;
    });

  const setLegal = (key: LegalKey, value: LegalSource) =>
    patch((d) => {
      d.contact[key] = value;
      return d;
    });

  /** Switching kind clears the other value. */
  const chooseKind = (key: LegalKey, kind: LegalKind) => {
    setPendingFile((p) => ({ ...p, [key]: kind === "file" }));
    if (kind === "url") setLegal(key, { kind: "url", url: "" });
    else setLegal(key, { kind: "none" });
  };

  return (
    <SectionShell sectionKey="contact" icon={Mail} description={t("description")} library={library}>
      <FieldGroup title={t("contactHeading")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t("email")}
            hint={t("emailHint")}
            error={contact.email && !isEmail(contact.email) ? t("emailError") : null}
          >
            {(id, invalid) => (
              <Input
                id={id}
                type="email"
                className="bg-background"
                value={contact.email}
                placeholder="hello@example.org"
                aria-invalid={invalid || undefined}
                onChange={(e) => set("email", e.target.value)}
              />
            )}
          </Field>
          <Field label={t("phone")} hint={t("phoneHint")} suffix={t("optional")}>
            {(id) => (
              <Input
                id={id}
                type="tel"
                className="bg-background font-mono text-sm"
                value={contact.phone}
                placeholder="+44 20 1234 5678"
                onChange={(e) => set("phone", e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label={t("address")} hint={t("addressHint")} suffix={t("optional")}>
          {(id) => (
            <Textarea
              id={id}
              className="bg-background"
              rows={3}
              value={contact.address}
              onChange={(e) => {
                const lines = e.target.value.split("\n").slice(0, ADDRESS_MAX_LINES);
                set("address", lines.join("\n"));
              }}
            />
          )}
        </Field>
      </FieldGroup>

      <FieldGroup title={t("recipientsHeading")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t("contactRecipient")}
            hint={t("contactRecipientHint")}
            error={contact.contactRecipient && !isEmail(contact.contactRecipient) ? t("emailError") : null}
          >
            {(id, invalid) => (
              <Input
                id={id}
                type="email"
                className="bg-background"
                value={contact.contactRecipient}
                placeholder={contact.email || t("contactRecipientPlaceholder")}
                aria-invalid={invalid || undefined}
                onChange={(e) => set("contactRecipient", e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t("takedownRecipient")}
            hint={t("takedownRecipientHint")}
            error={
              !contact.takedownRecipient.trim()
                ? t("takedownRequired")
                : !isEmail(contact.takedownRecipient)
                  ? t("emailError")
                  : null
            }
          >
            {(id, invalid) => (
              <Input
                id={id}
                type="email"
                className="bg-background"
                value={contact.takedownRecipient}
                placeholder="takedown@example.org"
                aria-invalid={invalid || undefined}
                onChange={(e) => set("takedownRecipient", e.target.value)}
              />
            )}
          </Field>
        </div>
      </FieldGroup>

      <FieldGroup title={t("legalHeading")} hint={t("legalHint")}>
        {LEGAL_KEYS.map((key) => {
          const source = contact[key];
          const shownKind: LegalKind = source.kind === "none" && pendingFile[key] ? "file" : source.kind;
          return (
            <div
              key={key}
              className="space-y-3 rounded-lg border border-border/50 bg-background p-3"
              data-legal={key}
              data-legal-kind={shownKind}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{t(`legal.${key}`)}</p>
                <Tabs value={shownKind} onValueChange={(kind) => chooseKind(key, kind as LegalKind)}>
                  <TabsList aria-label={t("legalSourceLabel", { page: t(`legal.${key}`) })}>
                    <TabsTrigger value="none">{t("legalKinds.none")}</TabsTrigger>
                    <TabsTrigger value="file">{t("legalKinds.file")}</TabsTrigger>
                    <TabsTrigger value="url">{t("legalKinds.url")}</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              {shownKind === "file" ? (
                <UploadField
                  label={t("legalFile")}
                  kind="legal"
                  required
                  slot={`${library.id}:legal:${key}`}
                  value={source.kind === "file" ? source.file : null}
                  onChange={(file) => {
                    setPendingFile((p) => ({ ...p, [key]: !file }));
                    setLegal(key, file ? { kind: "file", file } : { kind: "none" });
                  }}
                />
              ) : null}
              {source.kind === "url" ? (
                <Field label={t("legalUrl")} error={!isHttps(source.url) ? t("legalUrlError") : null}>
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
            </div>
          );
        })}
      </FieldGroup>
    </SectionShell>
  );
}
