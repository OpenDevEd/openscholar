"use client";

import { useState, useCallback } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { toast } from "sonner";
import { useAction, useMutation } from "convex/react";
import { motion, AnimatePresence } from "motion/react";
import { Loader2, Unplug, Clock, BookOpen } from "lucide-react";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { api } from "@/convex/_generated/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function ZoteroConnectionCard() {
  const t = useTranslations("connectionsPage.zotero");
  const tc = useTranslations("common");
  const format = useFormatter();

  const { data: status } = useProtectedQuery(api.zotero.queries.getConnectionStatus, {});
  const startOAuth = useAction(api.zotero.actions.startOAuth);
  const disconnectMutation = useMutation(api.zotero.mutations.disconnect);

  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    try {
      const callbackUrl = `${window.location.origin}/api/zotero/callback`;
      const { authorizeUrl } = await startOAuth({ callbackUrl });
      window.location.href = authorizeUrl;
      // Note: setConnecting(false) intentionally omitted — page is navigating away
    } catch {
      toast.error(t("oauthError", { error: "Failed to start OAuth" }));
      setConnecting(false);
    }
  }, [startOAuth, t]);

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      await disconnectMutation({});
      toast.success(t("disconnectSuccess"));
    } catch {
      toast.error(t("disconnectError"));
    } finally {
      setDisconnecting(false);
      setConfirmDisconnect(false);
    }
  }, [disconnectMutation, t]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="w-4 h-4" />
          {t("title")}
        </CardTitle>
        {(!status || !status.connected) && (
          <CardDescription>{t("disconnectedDescription")}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <div aria-live="polite">
          <AnimatePresence mode="wait">
            {status === undefined ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 text-sm text-muted-foreground py-2"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("loadingStatus")}
              </motion.div>
            ) : !status.connected ? (
              <motion.div
                key="disconnected"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <Button onClick={handleConnect} disabled={connecting} className="h-9">
                  {connecting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      {t("connecting")}
                    </>
                  ) : (
                    t("connectButton")
                  )}
                </Button>
              </motion.div>
            ) : (
              <motion.div
                key="connected"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="space-y-3"
              >
                {/* Status line */}
                <div className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0"
                    aria-hidden="true"
                  />
                  <span className="text-sm font-semibold text-foreground">
                    {t("connectedAs", { username: status.username ?? status.zoteroUserId })}
                  </span>
                </div>
                {/* Meta info */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <code className="font-mono">
                    {t("userId", { zoteroUserId: status.zoteroUserId })}
                  </code>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {t("connectedAt", {
                      time: format.relativeTime(new Date(status.connectedAt)),
                    })}
                  </span>
                </div>
                {/* Two-step disconnect confirmation (per D-01, connections/page.tsx pattern) */}
                <div className="pt-1">
                  <AnimatePresence mode="popLayout">
                    {confirmDisconnect ? (
                      <motion.div
                        key="confirm"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex items-center gap-2"
                      >
                        <button
                          onClick={() => setConfirmDisconnect(false)}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {tc("cancel")}
                        </button>
                        <button
                          onClick={handleDisconnect}
                          disabled={disconnecting}
                          className="flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
                        >
                          <Unplug className="w-3 h-3" />
                          {disconnecting ? t("connecting") : t("disconnectConfirm")}
                        </button>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="disconnect"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                      >
                        <button
                          onClick={() => setConfirmDisconnect(true)}
                          className="flex items-center gap-1.5 rounded-lg border border-destructive/30 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Unplug className="w-3 h-3" />
                          {t("disconnectButton")}
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </CardContent>
    </Card>
  );
}
