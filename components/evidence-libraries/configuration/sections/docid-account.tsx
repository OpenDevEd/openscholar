"use client";

// The DOCiD account Openscholar Reports registers with (plans/identifier-services), beside Zenodo and Crossref in
// the publishing settings, chosen the same way: our account on DOCiD's demo, or an account on DOCiD itself. What
// DOCiD files each report as is mapped from the report, by name, against the lists DOCiD gives the account.

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { docidResourceType } from "@opendeved/doi-sync-core/docid";
import { TriangleAlert } from "@/components/icons";
import type { PublicationSettings } from "@/convex/evidenceLibraries/publicationValidators";
import { Field } from "../section-card";
import { FieldGroup } from "../fields";
import { CredentialMode, type ActiveMode } from "./credential-mode";

type Docid = NonNullable<PublicationSettings["docid"]>;
export const NO_DOCID: Docid = { mode: "off", email: "" };

export function DocidAccount({
  docid = NO_DOCID,
  onChange,
  password,
  onPassword,
  stored,
  keptEmail,
}: {
  docid: Docid | undefined;
  onChange: (next: Docid) => void;
  password: string;
  onPassword: (value: string) => void;
  /** A password of the account on DOCiD itself is kept from an earlier save. */
  stored: boolean;
  /** That account's email, kept through a spell on the sandbox. */
  keptEmail: string | undefined;
}) {
  const t = useTranslations("publicationSettings");
  const update = (patch: Partial<Docid>) => onChange({ ...docid, ...patch });
  // Verified, and DOCiD doesn't let the account file reports under the resource type they map to.
  const cantFile = docid.options && !docidResourceType("Report", docid.options.resourceTypes);
  return (
    <FieldGroup
      title={<img src="/brands/docid.png" alt="DOCiD" className="h-6 w-auto" />}
      hint={t("docidHint")}
      action={<Switch aria-label={t("enableDocid")} checked={docid.mode !== "off"} onCheckedChange={(enabled) => update({ mode: enabled ? "sandbox" : "off" })} />}
    >
      {docid.mode !== "off" ? (
        <div className="space-y-4">
          <CredentialMode
            provider="DOCiD"
            value={docid.mode}
            // The account on DOCiD itself comes back as it was kept.
            onChange={(mode: ActiveMode) => update({ mode, ...(mode === "custom" && { email: keptEmail ?? "" }) })}
          >
            <div className="space-y-4">
              <p className="flex items-start gap-2 rounded-xl bg-inset px-3 py-2.5 text-xs text-pretty text-muted-foreground">
                <TriangleAlert className="mt-px size-3.5 shrink-0" />
                {t("docidPermanent")}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("docidEmail")}>{(id) => <Input id={id} type="email" autoComplete="off" value={docid.email} placeholder="name@example.org" onChange={(e) => update({ email: e.target.value })} />}</Field>
                <Field label={t("docidCredential")}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={password} placeholder={stored ? t("storedHint") : undefined} onChange={(e) => onPassword(e.target.value)} />}</Field>
              </div>
            </div>
          </CredentialMode>
          {cantFile ? (
            <p role="status" className="flex items-start gap-2 rounded-xl bg-inset px-3 py-2.5 text-xs text-pretty ink-warning">
              <TriangleAlert className="mt-px size-3.5 shrink-0" />
              {t("docidNoResourceTypes")}
            </p>
          ) : null}
        </div>
      ) : null}
    </FieldGroup>
  );
}
