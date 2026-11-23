"use client";

// The DOCiD account a publisher's records are registered with (plans/identifier-services), beside Zenodo and
// Crossref. DOCiD has no test service: every DOCiD is a real, permanent Handle, so there is only the real account.
// MOCK (mock/identifier-services): kept in this browser (identifiers-mock-store.ts), with English words, and not
// verified with DOCiD.

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TriangleAlert } from "@/components/icons";
import { setMockDocid, useMockDocid, type MockDocid } from "@/lib/reports/identifiers-mock-store";
import { Field } from "../section-card";
import { FieldGroup } from "../fields";

// DOCiD's own lists, as its API gave them on 2026-11-23. The build reads them with the account, which DOCiD filters by
// the account's category.
const RESOURCE_TYPES = [["1", "Indigenous Knowledge"], ["2", "Patent"], ["3", "Cultural Heritage"], ["4", "Project"], ["5", "Funder"], ["6", "Data Management Plan"], ["16", "Masters Thesis"], ["17", "PhD Thesis"]] as const;
const PUBLICATION_TYPES = [["1", "Article"], ["5", "Monograph"], ["6", "Preprint"], ["10", "Review Article"], ["19", "Book"]] as const;
const FUNDER_TYPES = [["1", "Grantor"], ["2", "Investor"], ["3", "Corporation"]] as const;

function Pick({ label, hint, value, options, onChange }: { label: string; hint?: string; value: string; options: ReadonlyArray<readonly [string, string]>; onChange: (v: string) => void }) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder="Choose one" />
          </SelectTrigger>
          <SelectContent>
            {options.map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}

export function DocidAccount() {
  const docid = useMockDocid();
  const update = (patch: Partial<MockDocid>) => setMockDocid({ ...docid, ...patch });
  return (
    <FieldGroup
      title={<img src="/brands/docid.png" alt="DOCiD" className="h-6 w-auto" />}
      hint="The Africa PID Alliance's identifier, a Handle under 20.500.14351."
      action={<Switch aria-label="Use DOCiD" checked={docid.on} onCheckedChange={(on) => update({ on })} />}
    >
      {docid.on ? (
        <div className="space-y-4">
          <p className="flex items-start gap-2 rounded-xl bg-inset px-3 py-2.5 text-xs text-pretty text-muted-foreground">
            <TriangleAlert className="mt-px size-3.5 shrink-0" />
            DOCiD has no test service. Every DOCiD it mints is a real Handle that can't be deleted, only retired.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email">
              {(id) => <Input id={id} type="email" autoComplete="off" value={docid.email} placeholder="name@example.org" onChange={(e) => update({ email: e.target.value })} />}
            </Field>
            <Field label="Password">
              {(id) => <Input id={id} type="password" autoComplete="new-password" />}
            </Field>
            <Pick label="Resource type" hint="What DOCiD files each record as. Your account may use only some." value={docid.resourceType} options={RESOURCE_TYPES} onChange={(resourceType) => update({ resourceType })} />
            <Pick label="File type" hint="How DOCiD lists the PDF." value={docid.publicationType} options={PUBLICATION_TYPES} onChange={(publicationType) => update({ publicationType })} />
            <Pick label="Funder type" value={docid.funderType} options={FUNDER_TYPES} onChange={(funderType) => update({ funderType })} />
          </div>
        </div>
      ) : null}
    </FieldGroup>
  );
}
