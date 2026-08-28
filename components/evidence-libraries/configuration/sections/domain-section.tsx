"use client";

import { useAction, useMutation } from "convex/react";
import { Copy, Link2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
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
  recordName: string;
  recordValue: string;
};

const STATE_TONE: Record<DomainRow["state"], StatusTone> = {
  added: "neutral",
  pointing: "neutral",
  verified: "running",
  active: "success",
  failed: "danger",
};

/** A bare domain has no room for the record every domain host needs. */
function isApex(host: string): boolean {
  return host.split(".").length === 2;
}

/**
 * The library's own web address. The owner adds two records where they manage
 * the domain, presses Check, and the library answers on the address. Domain
 * is not part of Save or Activate: every button here applies straight away.
 */
export function DomainSection({
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
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState<null | "add" | "check" | "remove" | "toggle">(
    null,
  );

  const domain: DomainRow | undefined = data?.domains[0];
  const verified =
    domain?.state === "verified" || domain?.state === "active";

  async function run<T>(
    kind: "add" | "check" | "remove" | "toggle",
    work: () => Promise<T>,
  ) {
    setBusy(kind);
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
    const typed = host.trim();
    if (!typed) return;
    const added = await run("add", () => addDomain({ libraryId, host: typed }));
    if (!added) return;
    if (added.status === "refused") {
      toast.error(t(`refused.${added.reason}`));
      return;
    }
    setHost("");
  }

  async function onCheck(domainId: Id<"evidenceLibraryDomains">) {
    const checked = await run("check", () => checkDomain({ libraryId, domainId }));
    if (!checked) return;
    if (checked.state === "failed") {
      toast.error(t(`failure.${checked.failure ?? "check-failed"}`));
    } else {
      toast.success(t(`status.${checked.state}`));
    }
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
      data-domain-state={domain?.state ?? "none"}
    >
      <Field label={t("platformLabel")} hint={t("platformHint")}>
        {(id) => (
          <ReadOnlyValue id={id} value={data?.platformAddress ?? ""} />
        )}
      </Field>

      {data && !data.platformReady ? (
        <Panel tone="muted" role="note">
          <p className="text-sm">{t("notSetUp")}</p>
        </Panel>
      ) : null}

      {data?.platformReady && !domain ? (
        <Field label={t("customLabel")} hint={t("customHint")}>
          {(id) => (
            <div className="flex gap-2">
              <Input
                id={id}
                className="bg-background font-mono text-sm"
                placeholder="library.example.org"
                value={host}
                onChange={(event) => setHost(event.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null || !host.trim()}
                onClick={() => void onAdd()}
              >
                {busy === "add" ? <Spinner /> : null}
                {t("add")}
              </Button>
            </div>
          )}
        </Field>
      ) : null}

      {domain ? (
        <>
          <Field label={t("customLabel")}>
            {(id) => <ReadOnlyValue id={id} value={domain.host} locked={false} />}
          </Field>

          {isApex(domain.host) ? (
            <Panel tone="muted" role="note">
              <p className="text-sm">{t("apex")}</p>
            </Panel>
          ) : null}

          <FieldGroup title={t("recordsHeading")} hint={t("recordsHint")}>
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
                  {[
                    {
                      type: "CNAME",
                      name: domain.host,
                      value: data?.target ?? "",
                    },
                    {
                      type: "TXT",
                      name: domain.recordName,
                      value: domain.recordValue,
                    },
                  ].map((record) => (
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
          </FieldGroup>

          <Panel
            tone="muted"
            className="flex flex-wrap items-center justify-between gap-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip
                tone={STATE_TONE[domain.state]}
                data-domain-status={domain.state}
              >
                {busy === "check" ? <Spinner /> : null}
                {domain.state === "failed" && domain.failure
                  ? t(`failure.${domain.failure}`)
                  : t(`status.${domain.state}`)}
              </StatusChip>
              {domain.attached ? (
                <StatusChip
                  tone={domain.certificateState === "active" ? "success" : "neutral"}
                  data-certificate={domain.certificateState ?? "pending"}
                >
                  {domain.certificateState === "active"
                    ? t("tlsActive")
                    : t("tlsPending")}
                </StatusChip>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => void onCheck(domain.domainId)}
              >
                {busy === "check" ? <Spinner /> : null}
                {t("checkDns")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy !== null}
                onClick={() =>
                  void run("remove", () =>
                    removeDomain({ libraryId, domainId: domain.domainId }),
                  )
                }
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("remove")}
              </Button>
            </div>
          </Panel>

          <ToggleRow
            label={t("redirectLabel")}
            hint={t("redirectHint")}
            checked={domain.role === "primary"}
            disabled={busy !== null || domain.state !== "active"}
            disabledReason={
              verified ? t("redirectWaiting") : t("redirectDisabled")
            }
            onChange={(checked) =>
              void run("toggle", () =>
                setPrimary({
                  libraryId,
                  domainId: domain.domainId,
                  primary: checked,
                }),
              )
            }
          />
        </>
      ) : null}
    </SectionCard>
  );
}
