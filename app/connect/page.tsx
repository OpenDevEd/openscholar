"use client";

import { useSearchParams } from "next/navigation";
import { useMutation, useAction, useQuery } from "convex/react";
import { useState, useCallback } from "react";
import { api } from "@/convex/_generated/api";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { SignIn } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspaces } from "@/components/workspaces/parts";
import { WorkspacePicker } from "@/components/workspaces/workspace-picker";

type ConnectState = "consent" | "creating" | "show_key" | "done" | "error";

export default function ConnectPage() {
  const tLabels = useTranslations("connectApp");
  const t = useTranslations("connectApp");
  const searchParams = useSearchParams();
  const redirectUri = searchParams.get("redirect_uri");
  const appName = searchParams.get("app_name") || tLabels("unknownApp");
  const isManualMode = !redirectUri || searchParams.get("mode") === "manual";
  const { phase, canRunProtectedQueries } = useAuthReadiness();

  const approveConnection = useMutation(api.wallet.mutations.approveConnection);
  const finalizeConnection = useAction(api.wallet.actions.finalizeConnection);

  const [state, setState] = useState<ConnectState>("consent");
  const [error, setError] = useState<string | null>(null);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // The app draws on one workspace's credits (#651): your own unless you pick another.
  const workspaces = useWorkspaces();
  const tw = useTranslations("workspaces");
  const [workspace, setWorkspace] = useState<Id<"workspaces"> | null>(null);
  const picked = workspace ?? workspaces.list?.[0]?.workspaceId;

  const redirectOrigin = (() => {
    try {
      return redirectUri ? new URL(redirectUri).origin : "";
    } catch {
      return "";
    }
  })();

  const isOriginAllowed = useQuery(
    api.wallet.queries.isOriginAllowed,
    !isManualMode && redirectOrigin ? { origin: redirectOrigin } : "skip",
  );

  const handleApprove = useCallback(async () => {
    if (!isManualMode && (!redirectUri || !redirectOrigin)) {
      setError("Invalid redirect_uri");
      setState("error");
      return;
    }

    if (!isManualMode && isOriginAllowed === false) {
      setError(tLabels("thisApplicationSOriginIsNot"));
      setState("error");
      return;
    }

    if (!picked) return;
    setState("creating");
    try {
      const walletKeyId = await approveConnection({
        appName,
        redirectOrigin: redirectOrigin || "manual",
        workspaceId: picked,
      });

      const { rawKey } = await finalizeConnection({ walletKeyId });

      if (isManualMode) {
        // Show the key on screen for copy-paste
        setGeneratedKey(rawKey);
        setState("show_key");
      } else {
        // Redirect back with the key
        const url = new URL(redirectUri!);
        url.searchParams.set("wallet_key", rawKey);
        window.location.href = url.toString();
        setState("done");
      }
    } catch (e) {
      console.error("[connect] Failed to create wallet key:", e);
      setError(e instanceof Error ? e.message : tLabels("failedToCreateConnection"));
      setState("error");
    }
  }, [redirectUri, redirectOrigin, appName, isManualMode, isOriginAllowed, approveConnection, finalizeConnection, picked]);

  const handleReject = useCallback(() => {
    if (isManualMode || isOriginAllowed !== true) {
      window.close();
      return;
    }
    const url = new URL(redirectUri!);
    url.searchParams.set("error", "access_denied");
    window.location.href = url.toString();
  }, [redirectUri, isManualMode, isOriginAllowed]);

  const handleCopy = useCallback(async () => {
    if (!generatedKey) return;
    await navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [generatedKey]);

  // ── Not authenticated ──────────────────────────────────────
  // The consent form shows once the workspaces to pick from have loaded, so it never grows under the pointer.
  const waiting = phase === "initializing" || (phase === "authenticated" && workspaces.list === undefined);
  if (phase === "anonymous" || waiting) {
    return (
      <div className="flex min-h-[calc(100dvh-2rem)] items-center justify-center p-6">
        {waiting ? (
          <AuthStatePanel variant="loading" />
        ) : (
          <div className="flex flex-col items-center gap-6">
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-semibold">{t("signInToContinue")}</h1>
              <p className="text-muted-foreground">
                {t.rich("wantsToConnect", { appName, strong: (chunks) => <strong>{chunks}</strong> })}
              </p>
            </div>
            <SignIn
              fallbackRedirectUrl={`/connect?${searchParams.toString()}`}
              signUpFallbackRedirectUrl={`/connect?${searchParams.toString()}`}
            />
          </div>
        )}
      </div>
    );
  }

  // ── Key created — show for manual copy ─────────────────────
  if (state === "show_key" && generatedKey) {
    return (
      <div className="flex min-h-[calc(100dvh-2rem)] items-center justify-center p-6">
        <div className="max-w-md w-full space-y-6">
          <div className="text-center space-y-2">
            <div className="text-3xl">&#x2713;</div>
            <h1 className="text-2xl font-semibold">{t("connectionCreated")}</h1>
            <p className="text-muted-foreground">
              {t.rich("copyKey", { appName, strong: (chunks) => <strong>{chunks}</strong> })}
            </p>
          </div>

          <div className="rounded-lg border p-4 space-y-3 bg-inset">
            <label className="text-xs font-medium text-muted-foreground">
              {t("apiKey")}
            </label>
            <div className="flex gap-2">
              <code className="flex-1 rounded-md border bg-background px-3 py-2.5 text-sm font-mono break-all select-all">
                {generatedKey}
              </code>
              <button
                onClick={handleCopy}
                className="shrink-0 rounded-md border px-3 py-2.5 text-sm font-medium hover:bg-muted transition-colors"
              >
                {copied ? t("copied") : t("copy")}
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs ink-warning">
            {t("thisKeyGrantsAccessToAi")}
          </div>

          <button
            onClick={() => window.close()}
            className="w-full rounded-lg border px-4 py-2.5 text-sm font-medium hover:bg-muted transition-colors"
          >
            {t("closeThisWindow")}
          </button>
        </div>
      </div>
    );
  }

  // ── Origin not allowed ──────────────────────────────────────
  if (!isManualMode && isOriginAllowed === false) {
    return (
      <div className="flex min-h-[calc(100dvh-2rem)] items-center justify-center p-6">
        <div className="max-w-md w-full space-y-6 text-center">
          <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <span className="text-2xl">&#x26D4;</span>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">{t("originNotRegistered")}</h1>
            <p className="text-muted-foreground">
              {t.rich("originUnregisteredBody", { origin: redirectOrigin, code: (chunks) => <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{chunks}</code> })}
            </p>
          </div>
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-muted-foreground text-start space-y-2">
            <p className="font-medium text-foreground">{t("whatDoesThisMean")}</p>
            <p>
              {t.rich("originHelp", { appName, strong: (chunks) => <strong>{chunks}</strong> })}
            </p>
          </div>
          <button
            onClick={() => window.close()}
            className="w-full rounded-lg border px-4 py-2.5 text-sm font-medium hover:bg-muted transition-colors"
          >
            {t("closeThisWindow")}
          </button>
        </div>
      </div>
    );
  }

  // ── Consent screen ─────────────────────────────────────────
  return (
    <div className="flex min-h-[calc(100dvh-2rem)] items-center justify-center p-6">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold">{t("connectApp")}</h1>
          <p className="text-muted-foreground">
            {t.rich("wantsToUseCredits", { appName, strong: (chunks) => <strong>{chunks}</strong> })}
          </p>
        </div>

        <div className="rounded-lg border p-4 space-y-3 bg-inset">
          <div className="text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("app")}</span>
              <span className="font-medium">{appName}</span>
            </div>
            {!isManualMode && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("origin")}</span>
                <span className="font-mono text-xs">{redirectOrigin}</span>
              </div>
            )}
          </div>
          <div className="text-xs text-muted-foreground border-t pt-3">
            {t("thisAppWillBeAbleTo")}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{tw("drawsOn")}</p>
          <WorkspacePicker value={picked} onChange={setWorkspace} disabled={state === "creating" || state === "done"} />
        </div>

        {state === "error" && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={handleReject}
            disabled={state === "creating" || state === "done"}
            className="flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            {isManualMode ? t("cancel") : t("reject")}
          </button>
          <button
            onClick={handleApprove}
            disabled={state === "creating" || state === "done" || !canRunProtectedQueries || !picked || (!isManualMode && isOriginAllowed !== true)}
            className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {state === "creating"
              ? t("creatingKey")
              : state === "done"
                ? t("redirecting")
                : t("approve")}
          </button>
        </div>
      </div>
    </div>
  );
}
