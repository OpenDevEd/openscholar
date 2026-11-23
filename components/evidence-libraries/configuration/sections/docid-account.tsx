"use client";

// The DOCiD account Openscholar Reports registers with (plans/identifier-services), beside Zenodo and Crossref in
// the publishing settings. DOCiD has no test service: every DOCiD is a real, permanent Handle, so there is only the
// real account. Its lists come from DOCiD when the account is verified and saved; until then the pickers say so.

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TooltipHint } from "@/components/ui/tooltip";
import { Lock, TriangleAlert } from "@/components/icons";
import type { PublicationSettings } from "@/convex/evidenceLibraries/publicationValidators";
import { Field } from "../section-card";
import { FieldGroup } from "../fields";

type Docid = NonNullable<PublicationSettings["docid"]>;
type Option = { id: number; name: string };
export const NO_DOCID: Docid = { mode: "off", email: "" };

function Pick({ label, hint, value, options, onChange }: { label: string; hint?: string; value: number | undefined; options: Option[] | undefined; onChange: (id: number) => void }) {
  const t = useTranslations("publicationSettings");
  return (
    <Field label={label} hint={hint}>
      {(id) =>
        options ? (
          <Select value={value === undefined ? undefined : String(value)} onValueChange={(picked) => onChange(Number(picked))}>
            <SelectTrigger id={id} className="w-full">
              <SelectValue placeholder={t("docidChoose")} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.id} value={String(option.id)}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          // No lists until the account is verified: drawn as the app draws what can't be used yet, saying why.
          <TooltipHint label={t("docidListsFirst")}>
            <span id={id} tabIndex={0} className="flex h-9 w-full cursor-default items-center gap-2 rounded-md border border-input px-3 text-sm text-muted-foreground opacity-50">
              <Lock className="size-3.5 shrink-0" />
              {t("docidChoose")}
            </span>
          </TooltipHint>
        )
      }
    </Field>
  );
}

export function DocidAccount({ docid = NO_DOCID, onChange, password, onPassword, stored }: { docid: Docid | undefined; onChange: (next: Docid) => void; password: string; onPassword: (value: string) => void; /** A password is kept from an earlier save. */ stored: boolean }) {
  const t = useTranslations("publicationSettings");
  const on = docid.mode === "custom";
  const update = (patch: Partial<Docid>) => onChange({ ...docid, ...patch });
  const allowsNone = docid.options && !docid.options.resourceTypes.length;
  return (
    <FieldGroup
      title={<img src="/brands/docid.png" alt="DOCiD" className="h-6 w-auto" />}
      hint={t("docidHint")}
      action={<Switch aria-label={t("enableDocid")} checked={on} onCheckedChange={(enabled) => update({ mode: enabled ? "custom" : "off" })} />}
    >
      {on ? (
        <div className="space-y-4">
          <p className="flex items-start gap-2 rounded-xl bg-inset px-3 py-2.5 text-xs text-pretty text-muted-foreground">
            <TriangleAlert className="mt-px size-3.5 shrink-0" />
            {t("docidPermanent")}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("email")}>{(id) => <Input id={id} type="email" autoComplete="off" value={docid.email} placeholder="name@example.org" onChange={(e) => update({ email: e.target.value })} />}</Field>
            <Field label={t("password")}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={password} placeholder={stored ? t("storedHint") : undefined} onChange={(e) => onPassword(e.target.value)} />}</Field>
            <Pick label={t("docidResourceType")} hint={allowsNone ? undefined : t("docidResourceTypeHint")} value={docid.resourceTypeId} options={docid.options?.resourceTypes} onChange={(resourceTypeId) => update({ resourceTypeId })} />
            <Pick label={t("docidFileType")} hint={t("docidFileTypeHint")} value={docid.publicationTypeId} options={docid.options?.publicationTypes} onChange={(publicationTypeId) => update({ publicationTypeId })} />
            <Pick label={t("docidFunderType")} value={docid.funderTypeId} options={docid.options?.funderTypes} onChange={(funderTypeId) => update({ funderTypeId })} />
          </div>
          {allowsNone ? (
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
