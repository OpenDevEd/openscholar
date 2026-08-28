"use client";

import { useAction, useMutation } from "convex/react";
import { Copy, Link2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { memo, useState } from "react";
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
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { FieldGroup, Panel, ReadOnlyValue, ToggleRow } from "../fields";
import { Field, SectionCard } from "../section-card";
import { StatusChip, type StatusTone } from "../status-chip";

type DomainFailure =
  | "no-name"
  | "no-records"
  | "wrong-target"
  | "token-mismatch"
  | "host-taken"
  | "not-served"
  | "certificate"
  | "caa-blocked"
  | "check-failed";

type DomainRow = {
  domainId: Id<"evidenceLibraryDomains">;
  host: string;
  role: "primary" | "redirect";
  state: "added" | "pointing" | "verified" | "active" | "failed";
  failure?: DomainFailure;
  certificateState?: "pending" | "active" | "failed";
  attached: boolean;
  removing: boolean;
  recordName: string;
  recordValue: string;
};

/** How the mock draws a domain's state. The server's five states map onto it. */
type DnsStatus = "none" | "pending" | "checking" | "verified" | "failed";

const STATUS_TONE: Record<DnsStatus, StatusTone> = {
  none: "neutral",
  pending: "neutral",
  checking: "running",
  verified: "success",
  failed: "danger",
};

function dnsStatusOf(row: DomainRow, checking: boolean): DnsStatus {
  if (checking) return "checking";
  if (row.state === "failed") return "failed";
  if (row.state === "verified" || row.state === "active") return "verified";
  return "pending";
}

/** A bare domain has no room for the record every domain host needs. */
function isApex(host: string): boolean {
  return host.split(".").length === 2;
}

/**
 * The library's own web address. The owner adds two records where they manage
 * the domain, presses Check DNS, and the library answers on the address.
 *
 * Domain is not part of Save or Activate: every button here applies straight
 * away.
 */
export const DomainSection = memo(function DomainSection({
  libraryId,
}: {
  libraryId: Id<"evidenceLibraries">;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.domain");
  const ts = useTranslations("evidenceLibraryConfiguration.sections");
  const { data } = useProtectedQuery(api.evidenceLibraries.domains.listDomains, {
    libraryId,
  });
  const addDomain = useAction(api.evidenceLibraries.domainActions.addDomain);
  const checkDomain = useAction(api.evidenceLibraries.domainActions.checkDomain);
  const removeDomain = useAction(api.evidenceLibraries.domainActions.removeDomain);
  const setPrimary = useMutation(api.evidenceLibraries.versions.setDomainPrimary);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const domains = data?.domains ?? [];
  const canAdd = Boolean(data?.platformReady) && domains.length < 5;

  async function run<T>(key: string, work: () => Promise<T>) {
    setBusy(key);
    try {
      return await work();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message ? error.message : t("failed"),
      );
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  async function onAdd() {
    const typed = custom.trim();
    if (!typed) return;
    const added = await run("add", () => addDomain({ libraryId, host: typed }));
    if (!added) return;
    if (added.status === "refused") {
      toast.error(t(`refused.${added.reason}`));
      return;
    }
    setCustom("");
  }

  async function onCheck(row: DomainRow) {
    const checked = await run(row.domainId, () =>
      checkDomain({ libraryId, domainId: row.domainId }),
    );
    if (!checked) return;
    if (checked.status === "busy") {
      toast.error(t("busy"));
      return;
    }
    if (checked.status === "check-failed") {
      toast.error(t("failure.check-failed"));
      return;
    }
    if (checked.state === "failed") {
      toast.error(t(`failure.${checked.failure ?? "check-failed"}`));
      return;
    }
    toast.success(t(`status.${dnsStatusOf({ ...row, state: checked.state }, false)}`));
  }

  function copy(value: string) {
    navigator.clipboard?.writeText(value).catch(() => undefined);
    toast.success(t("copied"), { description: value });
  }

  return (
    <SectionCard
      id="sec-domain"
      className="scroll-mt-40"
      icon={Link2}
      title={ts("domain")}
      description={t("description")}
      data-domain-state={domains[0]?.state ?? "none"}
    >
      <Field label={t("platformLabel")} hint={t("platformHint")}>
        {(id) => <ReadOnlyValue id={id} value={data?.platformAddress ?? ""} />}
      </Field>

      {data && !data.platformReady ? (
        <Panel tone="muted" role="note">
          <p className="text-sm">{t("notSetUp")}</p>
        </Panel>
      ) : null}

      {canAdd ? (
        <Field
          label={domains.length === 0 ? t("customLabel") : t("addAnother")}
          hint={t("customHint")}
        >
          {(id) => (
            <div className="flex gap-2">
              <Input
                id={id}
                className="bg-background font-mono text-sm"
                placeholder="library.example.org"
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null || !custom.trim()}
                onClick={() => void onAdd()}
              >
                {busy === "add" ? <Spinner /> : null}
                {t("add")}
              </Button>
            </div>
          )}
        </Field>
      ) : null}

      {domains.map((domain) => {
        const checking = busy === domain.domainId;
        const status = dnsStatusOf(domain, checking);
        const records = [
          { type: "CNAME", name: domain.host, value: data?.target ?? "" },
          { type: "TXT", name: domain.recordName, value: domain.recordValue },
        ];
        return (
          <FieldGroup
            key={domain.domainId}
            title={t("recordsHeading")}
            hint={t("recordsHint")}
            data-domain-host={domain.host}
            action={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy !== null || domain.removing}
                onClick={() =>
                  void run(domain.domainId, () =>
                    removeDomain({ libraryId, domainId: domain.domainId }),
                  )
                }
              >
                <Trash2 className="h-3.5 w-3.5" />
                {domain.removing ? t("removing") : t("remove")}
              </Button>
            }
          >
            <Field label={t("customLabel")}>
              {(id) => (
                <ReadOnlyValue id={id} value={domain.host} locked={false} />
              )}
            </Field>

            {isApex(domain.host) ? (
              <Panel tone="muted" role="note">
                <p className="text-sm">{t("apex")}</p>
              </Panel>
            ) : null}

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
                      <TableCell className="font-mono text-xs">
                        {record.type}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {record.name}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-xs">
                            {record.value}
                          </span>
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

            <Panel
              tone="muted"
              className="flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip tone={STATUS_TONE[status]} data-dns-status={status}>
                  {checking ? <Spinner /> : null}
                  {/* A failed check names what actually went wrong; the mock's
                      wording is the answer for a domain with no records. */}
                  {status === "failed" && domain.failure
                    ? t(`failure.${domain.failure}`)
                    : t(`status.${status}`)}
                </StatusChip>
                {domain.attached ? (
                  <StatusChip
                    tone={
                      domain.certificateState === "active" ? "success" : "neutral"
                    }
                    data-certificate={domain.certificateState ?? "pending"}
                  >
                    {domain.certificateState === "active"
                      ? t("tlsActive")
                      : t("tlsPending")}
                  </StatusChip>
                ) : null}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => void onCheck(domain)}
              >
                {checking ? <Spinner /> : null}
                {t("checkDns")}
              </Button>
            </Panel>

            <ToggleRow
              label={t("redirectLabel")}
              hint={t("redirectHint")}
              checked={domain.role === "primary"}
              disabled={busy !== null || domain.state !== "active"}
              disabledReason={
                domain.state === "verified"
                  ? t("redirectWaiting")
                  : t("redirectDisabled")
              }
              onChange={(checked) =>
                void run(domain.domainId, () =>
                  setPrimary({
                    libraryId,
                    domainId: domain.domainId,
                    primary: checked,
                  }),
                )
              }
            />
          </FieldGroup>
        );
      })}
    </SectionCard>
  );
});
