"use client";

import { useQuery, useMutation } from "convex/react";
import posthog from "posthog-js";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Plug, Trash2, Clock, Globe, ShieldCheck, ShieldOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export default function ConnectionsPage() {
  const { phase, canRunProtectedQueries } = useAuthReadiness();
  const keys = useQuery(
    api.wallet.queries.listMyKeys,
    canRunProtectedQueries ? {} : "skip",
  );
  const revokeKey = useMutation(api.wallet.mutations.revokeKey);

  const [revoking, setRevoking] = useState<Id<"walletKeys"> | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<Id<"walletKeys"> | null>(null);

  const handleRevoke = useCallback(
    async (walletKeyId: Id<"walletKeys">) => {
      const key = keys?.find((k) => k._id === walletKeyId);
      posthog.capture("api_key_revoked", {
        app_name: key?.appName,
      });
      setRevoking(walletKeyId);
      try {
        await revokeKey({ walletKeyId });
      } finally {
        setRevoking(null);
        setConfirmRevoke(null);
      }
    },
    [revokeKey, keys],
  );

  if (phase === "initializing") {
    return (
      <div className="p-6">
        <AuthStatePanel variant="loading" layout="inline" loadingStyle="spinner" />
      </div>
    );
  }

  if (phase === "anonymous") {
    return (
      <div className="p-6">
        <AuthStatePanel variant="sign_in_required" layout="inline" />
      </div>
    );
  }

  const activeKeys = keys?.filter((k) => k.isActive) ?? [];
  const revokedKeys = keys?.filter((k) => !k.isActive) ?? [];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-5 border-b border-border/40">
        <h2 className="text-lg font-semibold tracking-tight">Connected Apps</h2>
        <p className="text-sm text-muted-foreground">
          Manage external apps that use AI generation through your credits.
        </p>
      </div>

      {/* Content */}
      <div className="p-6 space-y-6 max-w-2xl">
        {/* Loading */}
        {!keys && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent mx-auto mb-2" />
            Loading connections...
          </div>
        )}

        {/* Empty state */}
        {keys && keys.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="py-16 text-center space-y-3"
          >
            <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mx-auto">
              <Plug className="w-6 h-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">No connected apps</p>
              <p className="text-sm text-muted-foreground mt-1">
                When external apps connect to your wallet, they will appear here.
              </p>
            </div>
          </motion.div>
        )}

        {/* Active keys */}
        {activeKeys.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wider">
              <ShieldCheck className="w-4 h-4" />
              <span>Active ({activeKeys.length})</span>
            </div>

            <div className="space-y-2">
              <AnimatePresence mode="popLayout">
                {activeKeys.map((key, i) => (
                  <motion.div
                    key={key._id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ delay: i * 0.05 }}
                    className="rounded-xl border border-border/50 bg-background p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-base truncate">
                          {key.appName}
                        </div>
                        <code className="text-xs font-mono text-muted-foreground">
                          {key.keyPrefix}
                        </code>
                      </div>

                      {/* Revoke button */}
                      {confirmRevoke === key._id ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setConfirmRevoke(null)}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleRevoke(key._id)}
                            disabled={revoking === key._id}
                            className="flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
                          >
                            <Trash2 className="w-3 h-3" />
                            {revoking === key._id ? "Revoking..." : "Confirm"}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmRevoke(key._id)}
                          className="flex items-center gap-1.5 rounded-lg border border-destructive/30 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                          Revoke
                        </button>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {key.redirectOrigin && key.redirectOrigin !== "manual" && (
                        <span className="flex items-center gap-1">
                          <Globe className="w-3 h-3" />
                          {key.redirectOrigin}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Created {formatRelativeTime(key.createdAt)}
                      </span>
                      {key.lastUsedAt && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Last used {formatRelativeTime(key.lastUsedAt)}
                        </span>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* Revoked keys */}
        {revokedKeys.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wider">
              <ShieldOff className="w-4 h-4" />
              <span>Revoked ({revokedKeys.length})</span>
            </div>

            <div className="space-y-2">
              {revokedKeys.map((key) => (
                <div
                  key={key._id}
                  className="rounded-xl border border-border/30 bg-muted/20 p-4 opacity-60"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate line-through decoration-muted-foreground/50">
                        {key.appName}
                      </div>
                      <code className="text-xs font-mono text-muted-foreground">
                        {key.keyPrefix}
                      </code>
                    </div>
                    <span className="text-xs text-muted-foreground border border-border/50 rounded-md px-2 py-0.5">
                      Revoked
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-2">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Created {formatRelativeTime(key.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
