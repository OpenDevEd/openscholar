"use client";

import { useAction, useMutation } from "convex/react";
import {
  ArrowRight01Icon,
  Copy01Icon,
  Delete02Icon,
  Globe02Icon,
  Home01Icon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { memo, useId, useState } from "react";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { LibraryAddressLink } from "../../library-address-link";
import { SectionCard } from "../section-card";
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
  const { data } = useProtectedQuery(
    api.evidenceLibraries.domains.listDomains,
    {
      libraryId,
    },
  );
  const addDomain = useAction(api.evidenceLibraries.domainActions.addDomain);
  const checkDomain = useAction(
    api.evidenceLibraries.domainActions.checkDomain,
  );
  const removeDomain = useAction(
    api.evidenceLibraries.domainActions.removeDomain,
  );
  const setPrimary = useMutation(
    api.evidenceLibraries.versions.setDomainPrimary,
  );
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const customId = useId();
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
  const hasDnsSetup = domains.some((domain) => domain.state !== "active");

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
      toast.error(
        checked.failure ? t(`failure.${checked.failure}`) : t("failed"),
      );
      return;
    }
    toast.success(
      t(`status.${dnsStatusOf({ ...row, state: checked.state }, false)}`),
    );
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
      {canAdd ? (
        <div className="flex gap-2">
          <label className="sr-only" htmlFor={customId}>
            {domains.length === 0 ? t("customLabel") : t("addAnother")}
          </label>
          <Input
            id={customId}
            className="bg-background font-mono text-sm"
            placeholder="library.example.org"
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
          />
          <Button
            type="button"
            disabled={busy !== null || !custom.trim()}
            onClick={() => void onAdd()}
          >
            {busy === "add" ? <Spinner /> : null}
            {t("add")}
          </Button>
        </div>
      ) : null}

      {suggestedWwwHost ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/15 bg-primary/5 px-3 py-2.5">
          <div className="flex min-w-0 items-start gap-2.5">
            <HugeiconsIcon
              icon={Globe02Icon}
              size={18}
              className="mt-0.5 shrink-0 text-primary"
            />
            <div>
              <p className="text-sm font-medium">{t("wwwTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("wwwHint")}</p>
            </div>
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
        </div>
      ) : null}

      {domains.length > 0 ? (
        <div className="space-y-2">
          {hasDnsSetup ? (
            <div>
              <p className="text-sm font-medium">{t("recordsHeading")}</p>
              <p className="text-xs text-muted-foreground">
                {t("recordsHint")}
              </p>
            </div>
          ) : null}
          <div className="overflow-hidden rounded-xl border border-border/60 bg-background">
            {domains.map((domain: DomainRow, index) => {
              const checking = busy === domain.domainId;
              const status = dnsStatusOf(domain, checking);
              const canChooseAsPrimary =
                domain.role === "primary" ||
                (domain.state === "active" && !domain.removing);

              return (
                <article
                  key={domain.domainId}
                  className={
                    index === 0 ? undefined : "border-t border-border/60"
                  }
                  data-domain-host={domain.host}
                >
                  <header className="flex flex-wrap items-center gap-2.5 px-3 py-2.5">
                    <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                      <HugeiconsIcon icon={Globe02Icon} size={17} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <LibraryAddressLink
                          address={`https://${domain.host}`}
                          className="max-w-full font-mono text-sm font-medium"
                        />
                        {status !== "failed" && status !== "verified" ? (
                          <StatusChip
                            tone={STATUS_TONE[status]}
                            data-dns-status={status}
                          >
                            {checking ? <Spinner /> : null}
                            {t(`status.${status}`)}
                          </StatusChip>
                        ) : null}
                      </div>
                      {status === "failed" && domain.failure ? (
                        <p
                          className="mt-0.5 text-xs text-destructive"
                          data-dns-status={status}
                        >
                          {t(`failure.${domain.failure}`)}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {status === "verified" ? (
                        <StatusChip
                          tone={STATUS_TONE.verified}
                          data-dns-status={status}
                        >
                          {t("status.verified")}
                        </StatusChip>
                      ) : null}
                      {domain.attached ? (
                        <StatusChip
                          tone={
                            domain.state === "active" ? "success" : "neutral"
                          }
                          data-certificate={
                            domain.state === "active" ? "active" : "pending"
                          }
                        >
                          {domain.state === "active"
                            ? t("tlsActive")
                            : t("tlsPending")}
                        </StatusChip>
                      ) : null}
                    </div>
                    {canChooseAsPrimary ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant={
                              domain.role === "primary" ? "secondary" : "ghost"
                            }
                            size="icon"
                            className="size-8"
                            aria-label={
                              domain.role === "primary"
                                ? t("confirmOffTitle")
                                : t("redirectLabel")
                            }
                            disabled={busy !== null}
                            onClick={() =>
                              setConfirming({
                                domainId: domain.domainId,
                                host: domain.host,
                                primary: domain.role !== "primary",
                              })
                            }
                          >
                            <HugeiconsIcon icon={Home01Icon} size={16} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {domain.role === "primary"
                            ? t("confirmOffTitle")
                            : t("redirectLabel")}
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy !== null || domain.removing}
                      onClick={() => void onCheck(domain)}
                    >
                      {checking ? (
                        <Spinner />
                      ) : (
                        <HugeiconsIcon icon={Refresh01Icon} size={15} />
                      )}
                      {t("checkDns")}
                    </Button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-destructive"
                          aria-label={
                            domain.removing ? t("removeAgain") : t("remove")
                          }
                          disabled={busy !== null}
                          onClick={() =>
                            void run(domain.domainId, () =>
                              removeDomain({
                                libraryId,
                                domainId: domain.domainId,
                              }),
                            )
                          }
                        >
                          <HugeiconsIcon icon={Delete02Icon} size={16} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {domain.removing ? t("removeAgain") : t("remove")}
                      </TooltipContent>
                    </Tooltip>
                  </header>

                  {domain.state !== "active" ? (
                    <div className="border-t border-border/50 bg-muted/10 px-3">
                      {domain.records.map((record, recordIndex) => (
                        <div
                          key={record.type}
                          className={`grid grid-cols-[3.25rem_minmax(0,1fr)_2rem] items-center gap-2 py-2 ${
                            recordIndex === 0 ? "" : "border-t border-border/40"
                          }`}
                        >
                          <span className="w-fit rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-muted-foreground">
                            {record.type}
                          </span>
                          <div className="grid min-w-0 items-center gap-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-2">
                            <span className="truncate font-mono text-xs">
                              {record.name}
                            </span>
                            <HugeiconsIcon
                              icon={ArrowRight01Icon}
                              size={14}
                              className="hidden text-muted-foreground/60 sm:block"
                            />
                            <span className="truncate font-mono text-xs text-muted-foreground">
                              {record.value}
                            </span>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={t("copyValue", { type: record.type })}
                            onClick={() => copy(record.value)}
                          >
                            <HugeiconsIcon icon={Copy01Icon} size={15} />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      ) : null}

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming?.primary ? t("confirmOnTitle") : t("confirmOffTitle")}
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
