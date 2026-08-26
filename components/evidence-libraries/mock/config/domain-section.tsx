"use client";

import { Copy, Link2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DnsStatus } from "@/lib/evidence-libraries/mock/config";
import { useEvidenceLibraryMockStore } from "@/lib/evidence-libraries/mock/store";
import { StatusChip, type StatusTone } from "../library-status-badge";
import { Field } from "../section-card";
import { ReadOnlyValue, SubHeading, ToggleRow } from "./fields";
import { SectionShell, type SectionProps } from "./section-shell";

const VERIFY_TOKEN = "os-verify=7f3a9c1e5b2d4a8f";

const STATUS_TONE: Record<DnsStatus, StatusTone> = {
  none: "neutral",
  pending: "neutral",
  checking: "running",
  verified: "success",
  failed: "danger",
};

export function DomainSection({ library, patch }: SectionProps) {
  const t = useTranslations("evidenceLibraryMock.config.domain");
  const checkDns = useEvidenceLibraryMockStore((s) => s.checkDns);
  const domain = library.draft.domain;
  const custom = domain.custom.trim();
  const verified = domain.status === "verified";
  const checking = domain.status === "checking";

  function setCustom(value: string) {
    patch((d) => {
      const changed = value.trim() !== d.domain.custom.trim();
      d.domain.custom = value;
      if (!value.trim()) {
        d.domain.status = "none";
        d.domain.redirectPlatform = false;
      } else if (changed && (d.domain.status === "verified" || d.domain.status === "failed")) {
        d.domain.status = "pending";
        d.domain.redirectPlatform = false;
      }
      return d;
    });
  }

  function copy(value: string) {
    navigator.clipboard?.writeText(value).catch(() => {});
    toast.success(t("copied"), { description: value });
  }

  const records = [
    { type: "CNAME", name: custom, value: library.address },
    { type: "TXT", name: `_openscholar.${custom}`, value: VERIFY_TOKEN },
  ];

  return (
    <SectionShell sectionKey="domain" icon={Link2} description={t("description")} library={library}>
      <Field label={t("platformLabel")} hint={t("platformHint")}>
        {(id) => (
          <ReadOnlyValue id={id} value={`https://${library.address}`} />
        )}
      </Field>

      <Field label={t("customLabel")} hint={t("customHint")}>
        {(id) => (
          <Input
            id={id}
            className="bg-background font-mono text-sm"
            placeholder="library.example.org"
            value={domain.custom}
            onChange={(e) => setCustom(e.target.value)}
          />
        )}
      </Field>

      {custom ? (
        <div className="space-y-3">
          <SubHeading>{t("recordsHeading")}</SubHeading>
          <p className="text-xs text-muted-foreground">{t("recordsHint")}</p>
          <div className="rounded-lg border border-border/50 bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">{t("colType")}</TableHead>
                  <TableHead>{t("colName")}</TableHead>
                  <TableHead>{t("colValue")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => (
                  <TableRow key={record.type}>
                    <TableCell className="font-mono text-xs">{record.type}</TableCell>
                    <TableCell className="font-mono text-xs">{record.name}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-xs">{record.value}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0"
                          aria-label={t("copyValue", { type: record.type })}
                          onClick={() => copy(record.value)}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/30 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone={STATUS_TONE[domain.status]} data-dns-status={domain.status}>
            {checking ? <Spinner /> : null}
            {t(`status.${domain.status}`)}
          </StatusChip>
          {verified ? <StatusChip tone="success">{t("tlsActive")}</StatusChip> : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={checking || !custom}
          onClick={() => checkDns(library.id)}
        >
          {checking ? <Spinner /> : null}
          {t("checkDns")}
        </Button>
      </div>

      <ToggleRow
        label={t("redirectLabel")}
        hint={t("redirectHint")}
        checked={domain.redirectPlatform}
        disabled={!verified}
        disabledReason={t("redirectDisabled")}
        onChange={(checked) =>
          patch((d) => {
            d.domain.redirectPlatform = checked;
            return d;
          })
        }
      />
    </SectionShell>
  );
}
