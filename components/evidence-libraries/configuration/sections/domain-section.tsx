"use client";

import { useAction, useMutation } from "convex/react";
import { Copy, Link2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { memo, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  | "caa-blocked";

type DomainRow = {
  domainId: Id<"evidenceLibraryDomains">;
  host: string;
  role: "primary" | "redirect";
  state: "added" | "pointing" | "verified" | "active" | "failed";
  failure?: DomainFailure;
  attached: boolean;
  removing: boolean;
  deploymentPending: boolean;
  isApex: boolean;
  suggestedWwwHost?: string;
  records: Array<{
    type: "A" | "CNAME" | "TXT";
    name: string;
    value: string;
  }>;
};

/** How the mock draws a domain's state. The server's five states map onto it. */
type DnsStatus = "pending" | "checking" | "verified" | "failed";

const STATUS_TONE: Record<DnsStatus, StatusTone> = {
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
  // Switching the library's address signs everyone out, so it is confirmed
  // first — in both directions.
  const [confirming, setConfirming] = useState<{
    domainId: Id<"evidenceLibraryDomains">;
    host: string;
    primary: boolean;
  } | null>(null);

  const domains = data?.domains ?? [];
  const canAdd = domains.length < 5;
  const suggestedWwwHost = domains.find(
    (domain) => domain.suggestedWwwHost,
  )?.suggestedWwwHost;

  async function run<T>(key: string, work: () => Promise<T>) {
    setBusy(key);
    try {
      return await work();
    } catch {
      // Never a message written by another service: the page says it in
      // this library's own words.
      toast.error(t("failed"));
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  async function onAdd(host = custom) {
    const typed = host.trim();
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
      toast.error(t("checkFailed"));
      return;
    }
    if (checked.status === "deploying") {
      toast.success(t("deploying"));
      return;
    }
    if (checked.status === "removing") {
      toast.error(t("removingNow"));
      return;
    }
    if (checked.state === "failed") {
      toast.error(checked.failure ? t(`failure.${checked.failure}`) : t("failed"));
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
      data-domain-state={domains[0]?.state ?? "empty"}
    >
      <Field label={t("platformLabel")} hint={t("platformHint")}>
        {(id) => <ReadOnlyValue id={id} value={data?.platformAddress ?? ""} />}
      </Field>

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

      {suggestedWwwHost ? (
        <Panel tone="muted" className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">{t("wwwTitle")}</p>
            <p className="text-sm text-muted-foreground">{t("wwwHint")}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={busy !== null || !canAdd}
            onClick={() => void onAdd(suggestedWwwHost)}
          >
            {busy === "add" ? <Spinner /> : null}
            {t("addWww", {
              host: suggestedWwwHost,
            })}
          </Button>
        </Panel>
      ) : null}

      {domains.map((domain: DomainRow) => {
        const checking = busy === domain.domainId;
        const status = dnsStatusOf(domain, checking);
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
                // A removal that stopped halfway is finished by pressing
                // again, so the button stays usable while one is under way.
                disabled={busy !== null}
                onClick={() =>
                  void run(domain.domainId, () =>
                    removeDomain({ libraryId, domainId: domain.domainId }),
                  )
                }
              >
                <Trash2 className="h-3.5 w-3.5" />
                {domain.removing ? t("removeAgain") : t("remove")}
              </Button>
            }
          >
            <Field label={t("customLabel")}>
              {(id) => (
                <ReadOnlyValue id={id} value={domain.host} locked={false} />
              )}
            </Field>

            {domain.isApex ? (
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
                  {domain.records.map((record) => (
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
                    tone={domain.state === "active" ? "success" : "neutral"}
                    data-certificate={domain.state === "active" ? "active" : "pending"}
                  >
                    {domain.state === "active"
                      ? t("tlsActive")
                      : t("tlsPending")}
                  </StatusChip>
                ) : null}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                // A domain on its way out is not checked again: that would
                // race the removal already running.
                disabled={busy !== null || domain.removing}
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
              // Turning it on needs a working domain and one that is not on
              // its way out. Turning the current address off is always
              // allowed: that is how an owner takes back the platform
              // address when a domain stops working.
              disabled={
                busy !== null ||
                (domain.role !== "primary" &&
                  (domain.state !== "active" || domain.removing))
              }
              disabledReason={
                domain.removing
                  ? t("removingNow")
                  : domain.state === "verified"
                    ? t("redirectWaiting")
                    : t("redirectDisabled")
              }
              onChange={(checked) =>
                setConfirming({
                  domainId: domain.domainId,
                  host: domain.host,
                  primary: checked,
                })
              }
            />
          </FieldGroup>
        );
      })}

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming?.primary
                ? t("confirmOnTitle")
                : t("confirmOffTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming?.primary
                ? t("confirmOnBody", { host: confirming?.host ?? "" })
                : t("confirmOffBody", {
                    address: data?.platformAddress ?? "",
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("confirmCancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const change = confirming;
                setConfirming(null);
                if (!change) return;
                void run(change.domainId, () =>
                  setPrimary({
                    libraryId,
                    domainId: change.domainId,
                    primary: change.primary,
                  }),
                );
              }}
            >
              {t("confirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
});
