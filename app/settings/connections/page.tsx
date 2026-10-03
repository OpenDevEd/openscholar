"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import posthog from "posthog-js";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { AppWindow, Globe, KeyRound, Plug, Trash2 } from "@/components/icons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { TooltipHint } from "@/components/ui/tooltip";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { Enter, LIST, Paged, pagerOf, Tile, Zone } from "@/components/settings/parts";

const PER_PAGE = 8;
const APP_TINTS = ["#a78bfa", "#60a5fa", "#34d399", "#f472b6", "#2dd4bf", "#d9a27c"];

export default function ConnectionsPage() {
  const t = useTranslations("connectionsPage");
  const tc = useTranslations("common");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const { data: keys } = useProtectedQuery(api.wallet.queries.listMyKeys, {});
  const revokeKey = useMutation(api.wallet.mutations.revokeKey);
  const [confirm, setConfirm] = useState<Id<"walletKeys"> | null>(null);
  const [revoking, setRevoking] = useState<Id<"walletKeys"> | null>(null);
  const [page, setPage] = useState(1);
  const [revokedPage, setRevokedPage] = useState(1);

  if (!keys) return <Enter ready={false}>{null}</Enter>;
  const active = keys.filter((k) => k.isActive);
  const revoked = keys.filter((k) => !k.isActive);
  const pager = pagerOf(active.length, PER_PAGE, page, setPage);
  const revokedPager = pagerOf(revoked.length, PER_PAGE, revokedPage, setRevokedPage);
  const shown = active.slice((pager.page - 1) * PER_PAGE, pager.page * PER_PAGE);
  const shownRevoked = revoked.slice((revokedPager.page - 1) * PER_PAGE, revokedPager.page * PER_PAGE);

  const revoke = async (walletKeyId: Id<"walletKeys">) => {
    posthog.capture("api_key_revoked", { app_name: keys.find((k) => k._id === walletKeyId)?.appName });
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
        <Zone label={t("connectedApps")}>
          {active.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
              <Plug className="size-5 text-muted-foreground" />
              <p className="text-sm font-medium">{t("noConnectedApps")}</p>
              <p className="max-w-sm text-xs text-muted-foreground">{t("noConnectedAppsDescription")}</p>
            </div>
          ) : (
            <Paged pager={pager} rowHeight={61} label={t("apps")}>
              <ul className={LIST}>
                <AnimatePresence initial={false}>
                  {shown.map((key, i) => (
                    <motion.li
                      key={key._id}
                      layout
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
                      className="flex items-center gap-3 p-3"
                    >
                      <Tile icon={AppWindow} tint={APP_TINTS[((pager.page - 1) * PER_PAGE + i) % APP_TINTS.length]!} />
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

        {revoked.length > 0 ? (
          <Zone label={t("revokedBadge")}>
            <Paged pager={revokedPager} rowHeight={61} label={t("apps")}>
              <ul className={LIST}>
                {shownRevoked.map((key) => (
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
