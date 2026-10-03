"use client";

import { useAction, useMutation } from "convex/react";
import {
  Copy01Icon,
  Delete02Icon,
  Globe02Icon,
  Home01Icon,
  Refresh01Icon,
  Undo02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { memo, useId, useState } from "react";
import { toast } from "sonner";
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
import { readConvexErrorData } from "@/convex/lib/errors";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { LibraryAddressLink } from "../../library-address-link";
import { InlineNotice, SectionCard } from "../section-card";
import { StatusChip, type StatusTone } from "../status-chip";

type DomainFailure =
  | "no-name"
  | "no-records"
  | "wrong-target"
  | "token-mismatch"
  | "host-taken"
  | "not-served"
  | "caa-blocked"
  | "tls-timeout";

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
  main: boolean;
  removeOnActivate: boolean;
  records: Array<{
    type: "A" | "CNAME" | "TXT";
    label: string;
    name: string;
    value: string;
  }>;
};

/** How the mock draws a domain's state. The server's five states map onto it. */
type DnsStatus = "pending" | "pointing" | "checking" | "verified" | "failed";

const STATUS_TONE: Record<DnsStatus, StatusTone> = {
  pending: "neutral",
  pointing: "running",
  checking: "running",
  verified: "success",
  failed: "danger",
};

function dnsStatusOf(row: DomainRow, checking: boolean): DnsStatus {
  if (checking) return "checking";
  if (row.state === "failed") return "failed";
  if (row.state === "pointing") return "pointing";
  if (row.state === "verified" || row.state === "active") return "verified";
  return "pending";
}

/**
 * The library's own web address. The owner adds two records where they manage
 * the domain, presses Check DNS, and the library answers on the address.
 *
 * Adding, checking and removing a domain apply straight away: none of that
 * changes what visitors see. Which address is the library's own, and taking
 * that one away, are changes like any other setting: saved at once, applied
 * by the next activation.
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
  const checkDomains = useAction(
    api.evidenceLibraries.domainActions.checkDomains,
  );
  const removeDomain = useAction(
    api.evidenceLibraries.domainActions.removeDomain,
  );
  const chooseMain = useMutation(
    api.evidenceLibraries.domains.chooseMainAddress,
  );
  const stageRemoval = useMutation(
    api.evidenceLibraries.domains.stageMainDomainRemoval,
  );
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const customId = useId();

  const domains = data?.domains ?? [];
  // The page and the backend are deployed separately; a backend that does
  // not report the chosen address yet means the live one.
  const mainAddress: string | undefined =
    data?.mainAddress ?? data?.canonicalAddress;
  const canAdd = domains.length < 5;
  const suggestedWwwHost = domains.find(
    (domain) => domain.suggestedWwwHost,
  )?.suggestedWwwHost;
  const hasDnsSetup = domains.some((domain) => domain.state !== "active");

  async function run<T>(key: string, work: () => Promise<T>) {
    setBusy(key);
    try {
      return await work();
    } catch (error) {
      // Never a message written by another service: only a refusal of our
      // own is shown as written, everything else in this library's words.
      const refusal = readConvexErrorData(error);
      toast.error(
        refusal?.message &&
          (refusal.code === "CONFLICT" || refusal.code === "NOT_FOUND")
          ? refusal.message
          : t("failed"),
      );
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

  async function onCheck() {
    const checked = await run("check", () => checkDomains({ libraryId }));
    if (!checked) return;
    if (checked.status === "rate-limited") {
      toast.error(t("rateLimited"));
      return;
    }
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
    if (checked.results.some((result) => result.state === "failed")) {
      toast.error(t("recordsNeedAttention"));
      return;
    }
    toast.success(t("checked"));
  }

  function copy(value: string) {
    navigator.clipboard?.writeText(value).catch(() => undefined);
    toast.success(t("copied"), { description: value });
  }

  return (
    <SectionCard
      id="sec-domain"
      icon={Link2}
      title={ts("domain")}
      description={t("description")}
      data-domain-state={domains[0]?.state ?? "empty"}
    >
      {data?.platformAddress ? (
        <div
          role="group"
          aria-label={t("platformLabel")}
          className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-background px-3 py-2.5"
          data-platform-address
        >
          <HugeiconsIcon
            icon={Globe02Icon}
            size={17}
            className="shrink-0 text-muted-foreground"
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">
              {t("platformLabel")}
            </p>
            <LibraryAddressLink
              address={data.platformAddress}
              className="max-w-full font-mono text-sm font-medium"
            />
          </div>
          {mainAddress === data.platformAddress ? (
            <StatusChip tone="success" data-main-address>
              {t("mainLabel")}
            </StatusChip>
          ) : null}
          <MainAddressButton
            main={mainAddress === data.platformAddress}
            label={t("mainLabel")}
            chooseLabel={t("redirectLabel")}
            disabled={busy !== null}
            onChoose={() =>
              void run("main", () => chooseMain({ libraryId, domainId: null }))
            }
          />
        </div>
      ) : null}

      {data?.mainNeedsAttention ? (
        <InlineNotice tone="warning" data-main-attention>
          {t("mainNeedsAttention")}
        </InlineNotice>
      ) : mainAddress && mainAddress !== data?.canonicalAddress ? (
        <InlineNotice tone="info" data-main-pending>
          {t("mainPending", {
            host: mainAddress.replace(/^https?:\/\//, ""),
          })}
        </InlineNotice>
      ) : null}

      <p className="text-sm font-medium">{t("customDomainsLabel")}</p>

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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{t("recordsHeading")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("recordsHint")}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => void onCheck()}
              >
                {busy === "check" ? (
                  <Spinner />
                ) : (
                  <HugeiconsIcon icon={Refresh01Icon} size={15} />
                )}
                {t("checkDns")}
              </Button>
            </div>
          ) : null}
          <div className="overflow-hidden rounded-xl border border-border/60 bg-background">
            {domains.map((domain: DomainRow, index) => {
              const checking = busy === "check" && domain.state !== "active";
              const status = dnsStatusOf(domain, checking);
              const canBeMain =
                domain.main ||
                (domain.state === "active" &&
                  !domain.removing &&
                  !domain.removeOnActivate);
              // The address visitors reach now is taken away at the next
              // activation, like any other change; every other domain goes
              // straight away.
              // A removal already under way can only be finished.
              const removeLater =
                !domain.removing &&
                (domain.role === "primary" || domain.removeOnActivate);
              const removeLabel = domain.removing
                ? t("removeAgain")
                : domain.removeOnActivate
                  ? t("keep")
                  : t("remove");

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
                      {domain.removeOnActivate ? (
                        <StatusChip tone="warning" data-remove-on-activate>
                          {t("removeOnActivate")}
                        </StatusChip>
                      ) : domain.main ? (
                        <StatusChip tone="success" data-main-address>
                          {t("mainLabel")}
                        </StatusChip>
                      ) : null}
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
                    {canBeMain ? (
                      <MainAddressButton
                        main={domain.main}
                        label={t("mainLabel")}
                        chooseLabel={t("redirectLabel")}
                        disabled={busy !== null}
                        onChoose={() =>
                          void run("main", () =>
                            chooseMain({
                              libraryId,
                              domainId: domain.domainId,
                            }),
                          )
                        }
                      />
                    ) : null}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-destructive"
                          aria-label={removeLabel}
                          aria-pressed={
                            removeLater ? domain.removeOnActivate : undefined
                          }
                          disabled={busy !== null}
                          onClick={() =>
                            void run(domain.domainId, () =>
                              removeLater
                                ? stageRemoval({
                                    libraryId,
                                    domainId: domain.domainId,
                                    remove: !domain.removeOnActivate,
                                  })
                                : removeDomain({
                                    libraryId,
                                    domainId: domain.domainId,
                                  }),
                            )
                          }
                        >
                          <HugeiconsIcon
                            icon={
                              domain.removeOnActivate && !domain.removing
                                ? Undo02Icon
                                : Delete02Icon
                            }
                            size={16}
                          />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{removeLabel}</TooltipContent>
                    </Tooltip>
                  </header>

                  {domain.state !== "active" ? (
                    <div className="border-t border-border/50 bg-muted/10 px-3">
                      {domain.records.map((record, recordIndex) => (
                        <div
                          key={record.type}
                          className={`grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 py-2 sm:grid-cols-[3.25rem_minmax(0,1fr)_minmax(0,1.5fr)] ${
                            recordIndex === 0 ? "" : "border-t border-border/40"
                          }`}
                        >
                          <span className="w-fit rounded-md bg-muted px-1.5 py-0.5 font-mono text-2xs font-semibold text-muted-foreground">
                            {record.type}
                          </span>
                          <div className="flex min-w-0 items-center gap-1">
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-mono text-xs font-medium">
                                {record.label}
                              </p>
                              <p className="truncate font-mono text-3xs text-muted-foreground">
                                {record.name}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8 shrink-0"
                              aria-label={t("copyName", { type: record.type })}
                              onClick={() => copy(record.label)}
                            >
                              <HugeiconsIcon icon={Copy01Icon} size={15} />
                            </Button>
                          </div>
                          <div className="col-start-2 flex min-w-0 items-center gap-1 sm:col-start-3">
                            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                              {record.value}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8 shrink-0"
                              aria-label={t("copyValue", { type: record.type })}
                              onClick={() => copy(record.value)}
                            >
                              <HugeiconsIcon icon={Copy01Icon} size={15} />
                            </Button>
                          </div>
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

    </SectionCard>
  );
});

/**
 * Chooses the library's main address. Pressed on the one chosen; pressing it
 * again goes back to the platform address. Nothing changes for visitors
 * until the next activation.
 */
function MainAddressButton({
  main,
  label,
  chooseLabel,
  disabled,
  onChoose,
}: {
  main: boolean;
  label: string;
  chooseLabel: string;
  disabled: boolean;
  onChoose: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={main ? "secondary" : "ghost"}
          size="icon"
          className="size-8"
          aria-label={main ? label : chooseLabel}
          aria-pressed={main}
          disabled={disabled || main}
          onClick={onChoose}
        >
          <HugeiconsIcon icon={Home01Icon} size={16} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{main ? label : chooseLabel}</TooltipContent>
    </Tooltip>
  );
}
