"use client";

import { useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion } from "motion/react";
import posthog from "posthog-js";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { AppWindow, Globe, KeyRound, PersonIcon, Plug, Trash2 } from "@/components/icons";
import { ZoteroIcon } from "@/components/icons/zotero-icon";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TooltipHint } from "@/components/ui/tooltip";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { useZoteroSignIn } from "@/lib/hooks/use-zotero-sign-in";
import { useAppToast } from "@/lib/toast";
import { Enter, LIST, Paged, Tile, Zone } from "@/components/settings/parts";
import { inWorkspace, useWorkspace } from "@/lib/workspaces/url";
import { WorkspaceTag } from "@/components/workspaces/parts";

const PER_PAGE = 8;
const APP_TINTS = ["#a78bfa", "#60a5fa", "#34d399", "#f472b6", "#2dd4bf", "#d9a27c"];

export default function ConnectionsPage() {
  const workspaceId = useWorkspace();
  const t = useTranslations("connectionsPage");
  const tc = useTranslations("common");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  // Each list is read a page at a time, newest first; the counts total their pages.
  const active = useCursorPage(api.wallet.queries.listKeys, inWorkspace(workspaceId, { active: true }), PER_PAGE);
  const revoked = useCursorPage(api.wallet.queries.listKeys, inWorkspace(workspaceId, { active: false }), PER_PAGE);
  const { data: counts } = useProtectedQuery(api.wallet.queries.countKeys, inWorkspace(workspaceId, {}));
  const { data: zotero } = useProtectedQuery(api.zotero.queries.getConnectionStatus, {});
  const revokeKey = useMutation(api.wallet.mutations.revokeKey);
  const [confirm, setConfirm] = useState<Id<"walletKeys"> | null>(null);
  const [revoking, setRevoking] = useState<Id<"walletKeys"> | null>(null);

  if (active.isLoading || revoked.isLoading || !counts || !zotero) return <Enter ready={false}>{null}</Enter>;

  const revoke = async (walletKeyId: Id<"walletKeys">) => {
    posthog.capture("api_key_revoked", { app_name: active.items.find((k) => k._id === walletKeyId)?.appName });
    setRevoking(walletKeyId);
    try {
      await revokeKey({ walletKeyId });
    } finally {
      setRevoking(null);
      setConfirm(null);
    }
  };

  return (
    <Enter ready>
      <div className="space-y-8">
        {/* Services you connect your account to. Each new one is a row in this list. */}
        <Zone label={t("integrations")}>
          <ul className={LIST}>
            <ZoteroRow account={zotero} />
          </ul>
        </Zone>

        <Zone label={t("connectedApps")}>
          {active.items.length === 0 && !active.hasPages ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
              <Plug className="size-5 text-muted-foreground" />
              <p className="text-sm font-medium">{t("noConnectedApps")}</p>
              <p className="max-w-sm text-xs text-muted-foreground">{t("noConnectedAppsDescription")}</p>
            </div>
          ) : (
            <Paged pager={{ list: active, size: PER_PAGE, total: counts.active }} rowHeight={61} label={t("apps")}>
              {/* A new list for each page, so stepping swaps the rows at once; a revoked row leaves in place, without pushing the pager down. */}
              <ul key={active.page} className={`${LIST} relative`}>
                <AnimatePresence initial={false} mode="popLayout">
                  {active.items.map((key, i) => (
                    <motion.li
                      key={key._id}
                      layout
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
                      className="flex items-center gap-3 p-3"
                    >
                      <Tile icon={AppWindow} tint={APP_TINTS[(active.offset + i) % APP_TINTS.length]!} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{key.appName}</p>
                        <p className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
                          <span className="inline-flex shrink-0 items-center gap-1 font-mono text-2xs">
                            <KeyRound className="size-3" /> {key.keyPrefix}
                          </span>
                          {key.redirectOrigin && key.redirectOrigin !== "manual" ? (
                            <span className="inline-flex min-w-0 items-center gap-1">
                              <Globe className="size-3 shrink-0" />
                              <span className="truncate">{key.redirectOrigin.replace(/^https?:\/\//, "")}</span>
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <WorkspaceTag workspace={key.workspace} size="sm" />
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {key.lastUsedAt
                          ? t("lastUsed", { time: format.relativeTime(key.lastUsedAt, now) })
                          : t("created", { time: format.relativeTime(key.createdAt, now) })}
                      </span>
                      <div className="flex w-40 shrink-0 justify-end">
                        {confirm === key._id ? (
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                              {tc("cancel")}
                            </Button>
                            <Button variant="destructive" size="sm" disabled={revoking === key._id} onClick={() => revoke(key._id)}>
                              {revoking === key._id ? t("revoking") : t("revoke")}
                            </Button>
                          </div>
                        ) : (
                          <TooltipHint label={t("revoke")}>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-muted-foreground hover:text-destructive"
                              aria-label={t("revokeApp", { app: key.appName })}
                              onClick={() => setConfirm(key._id)}
                            >
                              <Trash2 />
                            </Button>
                          </TooltipHint>
                        )}
                      </div>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </Paged>
          )}
        </Zone>

        {revoked.items.length > 0 || revoked.hasPages ? (
          <Zone label={t("revokedBadge")}>
            <Paged pager={{ list: revoked, size: PER_PAGE, total: counts.revoked }} rowHeight={61} label={t("apps")}>
              <ul className={LIST}>
                {revoked.items.map((key) => (
                  <li key={key._id} className="flex items-center gap-3 p-3 text-muted-foreground">
                    <Tile icon={AppWindow} tint="#94a3b8" />
                    <span className="min-w-0 flex-1 truncate text-sm line-through decoration-muted-foreground/50">{key.appName}</span>
                    <span className="font-mono text-2xs">{key.keyPrefix}</span>
                  </li>
                ))}
              </ul>
            </Paged>
          </Zone>
        ) : null}
      </div>
    </Enter>
  );
}

/** Your Zotero account: the assistant and your Evidence Libraries read your libraries and groups through it. */
function ZoteroRow({ account }: { account: FunctionReturnType<typeof api.zotero.queries.getConnectionStatus> }) {
  const t = useTranslations("connectionsPage");
  const tc = useTranslations("common");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const toast = useAppToast();
  const signIn = useZoteroSignIn();
  const disconnect = useMutation(api.zotero.mutations.disconnect);
  const [step, setStep] = useState<"idle" | "confirm" | "busy">("idle");

  const connect = async () => {
    setStep("busy");
    try {
      // The page goes to Zotero from here, so the spinner stays until it leaves.
      await signIn();
    } catch (error) {
      toast.zotero.failed(error);
      setStep("idle");
    }
  };
  const leave = async () => {
    setStep("busy");
    try {
      await disconnect({});
    } catch {
      toast.error(t("disconnectFailed"));
    } finally {
      setStep("idle");
    }
  };

  // The line under the name: what Zotero is for, the account it's connected to, or what disconnecting leaves in place.
  const line = !account.connected ? (
    <span className="truncate">{t("zoteroAbout")}</span>
  ) : step === "confirm" ? (
    <span className="truncate">{t("zoteroKeeps")}</span>
  ) : (
    <span className="inline-flex min-w-0 items-center gap-1">
      <PersonIcon className="size-3 shrink-0" />
      <span className="truncate">{account.username ?? account.zoteroUserId}</span>
    </span>
  );

  return (
    <li className="flex items-center gap-3 p-3" data-zotero={account.connected ? "connected" : "not-connected"}>
      <Tile icon={ZoteroIcon} tint="#cc2936" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">Zotero</p>
        <Swap id={`${account.connected}-${step === "confirm"}`} className="flex min-w-0 items-center text-xs text-muted-foreground">
          {line}
        </Swap>
      </div>
      {account.connected ? (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {t("connectedTime", { time: format.relativeTime(account.connectedAt, now) })}
        </span>
      ) : null}
      <Swap id={account.connected ? (step === "confirm" ? "confirm" : "connected") : "not-connected"} className="flex w-40 shrink-0 justify-end gap-1">
        {!account.connected ? (
          <Button size="sm" disabled={step === "busy"} onClick={connect}>
            {step === "busy" ? <Spinner /> : null}
            {t("connect")}
          </Button>
        ) : step === "confirm" ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => setStep("idle")}>
              {tc("cancel")}
            </Button>
            <Button variant="destructive" size="sm" onClick={leave}>
              {t("disconnect")}
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" disabled={step === "busy"} onClick={() => setStep("confirm")}>
            {step === "busy" ? <Spinner /> : null}
            {t("disconnect")}
          </Button>
        )}
      </Swap>
    </li>
  );
}

/** Fades its contents in when `id` changes, so a row's state swaps in place without a jump. */
function Swap({ id, className, children }: { id: string; className: string; children: ReactNode }) {
  return (
    <motion.div key={id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }} className={className}>
      {children}
    </motion.div>
  );
}
