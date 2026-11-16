"use client";

import { useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion } from "motion/react";
import posthog from "posthog-js";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { AppWindow, ExternalLink, Globe, KeyRound, PersonIcon, Plug, Trash2 } from "@/components/icons";
import { ZoteroIcon } from "@/components/icons/zotero-icon";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { TooltipHint } from "@/components/ui/tooltip";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useCursorPageAt } from "@/lib/hooks/use-cursor-page";
import { useZoteroSignIn } from "@/lib/hooks/use-zotero-sign-in";
import { useAppToast } from "@/lib/toast";
import { Enter, LIST, Paged, Tile, Working, Zone } from "@/components/settings/parts";
import { inWorkspace, useWorkspace } from "@/lib/workspaces/url";
import { WorkspaceTag } from "@/components/workspaces/parts";
import { APPS_PER_PAGE, DeveloperApps } from "@/components/settings/developer-apps";
import { getErrorMessage } from "@/lib/toast/use-app-toast";

const PER_PAGE = 8;
const APP_TINTS = ["#a78bfa", "#60a5fa", "#34d399", "#f472b6", "#2dd4bf", "#d9a27c"];

export default function ConnectionsPage() {
  const workspaceId = useWorkspace();
  const t = useTranslations("connectionsPage");
  const tc = useTranslations("common");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  // Each list is read a page at a time, newest first; the counts total their pages.
  const active = useCursorPageAt("keys", api.wallet.queries.listKeys, inWorkspace(workspaceId, { active: true }), PER_PAGE, { scroll: false });
  const revoked = useCursorPageAt("revoked", api.wallet.queries.listKeys, inWorkspace(workspaceId, { active: false }), PER_PAGE, { scroll: false });
  const { data: counts } = useProtectedQuery(api.wallet.queries.countKeys, inWorkspace(workspaceId, {}));
  const { data: zotero } = useProtectedQuery(api.zotero.queries.getConnectionStatus, {});
  const apps = useCursorPageAt("apps", api.developerApps.apps.listApps, {}, APPS_PER_PAGE, { scroll: false });
  const { data: appCount } = useProtectedQuery(api.developerApps.apps.countApps, {});
  const sites = useCursorPageAt("sites", api.developerApps.sites.listSites, {}, PER_PAGE, { scroll: false });
  const revokeKey = useMutation(api.wallet.mutations.revokeKey);
  const [confirm, setConfirm] = useState<Id<"walletKeys"> | null>(null);
  const [revoking, setRevoking] = useState<Id<"walletKeys"> | null>(null);

  if (active.isLoading || revoked.isLoading || !counts || !zotero || apps.isLoading || appCount === undefined || sites.isLoading) return <Enter ready={false}>{null}</Enter>;

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
          <ul className={`${LIST} @container/integrations`}>
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
                      <Tile icon={AppWindow} tint={APP_TINTS[(active.offset + i) % APP_TINTS.length]!} className="self-start" />
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

        <AllowedSites sites={sites} />

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

        <DeveloperApps apps={apps} count={appCount} />
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
  const failed = !account.connected && signIn.failed;
  const disconnect = useMutation(api.zotero.mutations.disconnect);
  const [step, setStep] = useState<"idle" | "confirm" | "busy">("idle");

  const connect = async () => {
    setStep("busy");
    try {
      // The page goes to Zotero from here, so the spinner stays until it leaves.
      await signIn.start();
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

  // The line under the name: what Zotero is for, why the last sign-in failed, the account it's connected to, or what disconnecting leaves in place.
  const line = failed ? (
    <span className="truncate text-destructive">{tc("zoteroSignInFailed")}</span>
  ) : !account.connected ? (
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
      <Tile icon={ZoteroIcon} tint="#cc2936" className="self-start" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">Zotero</p>
        <Swap id={`${account.connected}-${step === "confirm"}-${failed}`} className="flex min-w-0 items-center text-xs text-muted-foreground">
          {line}
        </Swap>
      </div>
      {account.connected ? (
        // A narrow list keeps the account name and the buttons, and leaves out when it was connected.
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground @max-[32rem]/integrations:hidden">
          {t("connectedTime", { time: format.relativeTime(account.connectedAt, now) })}
        </span>
      ) : null}
      <Swap id={account.connected ? (step === "confirm" ? "confirm" : "connected") : "not-connected"} className="flex w-40 shrink-0 justify-end gap-1">
        {!account.connected ? (
          <Button size="sm" className="relative" disabled={step === "busy"} onClick={connect}>
            <Working busy={step === "busy"}>{t("connect")}</Working>
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
          <Button variant="outline" size="sm" className="relative" disabled={step === "busy"} onClick={() => setStep("confirm")}>
            <Working busy={step === "busy"}>{t("disconnect")}</Working>
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

type Site = FunctionReturnType<typeof api.developerApps.sites.listSites>["page"][number];
const SITE_TINTS = ["#60a5fa", "#f472b6", "#2dd4bf", "#a78bfa", "#d9a27c", "#34d399"];

/**
 * Sites you signed in to through an app on Openscholar, newest allowed first. A site is listed once it
 * changes something for you. Disconnect signs it out of your account; it stays out until you allow it again.
 */
function AllowedSites({ sites }: { sites: ReturnType<typeof useCursorPageAt<typeof api.developerApps.sites.listSites>> }) {
  const t = useTranslations("connectionsPage");
  return (
    <Zone label={t("allowedSites")}>
      {sites.items.length === 0 && !sites.hasPages ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
          <Globe className="size-5 text-muted-foreground" />
          <p className="text-sm font-medium">{t("noSites")}</p>
          <p className="max-w-sm text-xs text-muted-foreground">{t("noSitesDescription")}</p>
        </div>
      ) : (
        <Paged pager={{ list: sites, size: PER_PAGE }} rowHeight={61} label={t("sites")}>
          <ul key={sites.page} className={`${LIST} @container/sites`}>
            {sites.items.map((site, i) => (
              <SiteRow key={site._id} site={site} tint={SITE_TINTS[(sites.offset + i) % SITE_TINTS.length]!} />
            ))}
          </ul>
        </Paged>
      )}
    </Zone>
  );
}

/** One site: its name and address, when it was last used or disconnected, a link to it, and Disconnect (with a confirm) or Allow again. */
function SiteRow({ site, tint }: { site: Site; tint: string }) {
  const t = useTranslations("connectionsPage");
  const tc = useTranslations("common");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const toast = useAppToast();
  const setDisconnected = useMutation(api.developerApps.sites.setDisconnected);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const change = async (disconnected: boolean) => {
    setBusy(true);
    try {
      await setDisconnected({ siteId: site._id, disconnected });
      setConfirm(false);
    } catch (error) {
      toast.error(getErrorMessage(error, tc("somethingWentWrong")));
    } finally {
      setBusy(false);
    }
  };
  const address = site.website.replace(/^https?:\/\//, "");
  const when = site.disconnectedAt
    ? t("disconnectedTime", { time: format.relativeTime(Math.min(site.disconnectedAt, now.getTime()), now) })
    : t("lastUsed", { time: format.relativeTime(Math.min(site.lastUsedAt, now.getTime()), now) });

  return (
    <li className="flex items-center gap-3 p-3">
      <Tile icon={Globe} tint={site.disconnectedAt ? "#94a3b8" : tint} className="self-start transition-colors" />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-semibold transition-colors ${site.disconnectedAt ? "text-muted-foreground" : ""}`}>{site.name}</p>
        <Swap id={String(confirm)} className="flex min-w-0 items-center text-xs text-muted-foreground">
          {confirm ? (
            <span className="truncate">{t("siteSignsOut")}</span>
          ) : (
            <span className="truncate">{address}</span>
          )}
        </Swap>
      </div>
      <Swap id={site.disconnectedAt ? "gone" : "allowed"} className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground @max-[34rem]/sites:hidden">
        {when}
      </Swap>
      <TooltipHint label={t("openSite", { site: address })}>
        <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label={t("openSite", { site: address })} asChild>
          <a href={site.website} target="_blank" rel="noreferrer">
            <ExternalLink />
          </a>
        </Button>
      </TooltipHint>
      <Swap id={site.disconnectedAt ? "gone" : String(confirm)} className="flex w-40 shrink-0 justify-end gap-1">
        {site.disconnectedAt ? (
          <Button variant="outline" size="sm" className="relative" disabled={busy} onClick={() => change(false)}>
            <Working busy={busy}>{t("allowAgain")}</Working>
          </Button>
        ) : confirm ? (
          <>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirm(false)}>
              {tc("cancel")}
            </Button>
            <Button variant="destructive" size="sm" className="relative" disabled={busy} onClick={() => change(true)}>
              <Working busy={busy}>{t("disconnect")}</Working>
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setConfirm(true)}>
            {t("disconnect")}
          </Button>
        )}
      </Swap>
    </li>
  );
}
