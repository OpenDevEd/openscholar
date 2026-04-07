"use client";

import { useSearchParams } from "next/navigation";
import { useMutation, useAction, useQuery } from "convex/react";
import { useState, useCallback } from "react";
import { api } from "@/convex/_generated/api";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { SignIn } from "@clerk/nextjs";

type ConnectState = "consent" | "creating" | "show_key" | "done" | "error";

export default function ConnectPage() {
  const searchParams = useSearchParams();
  const redirectUri = searchParams.get("redirect_uri");
  const appName = searchParams.get("app_name") || "Unknown App";
  const isManualMode = !redirectUri || searchParams.get("mode") === "manual";
  const { phase, canRunProtectedQueries } = useAuthReadiness();

  const approveConnection = useMutation(api.wallet.mutations.approveConnection);
  const finalizeConnection = useAction(api.wallet.actions.finalizeConnection);

  const [state, setState] = useState<ConnectState>("consent");
  const [error, setError] = useState<string | null>(null);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
      setError("This application's origin is not registered");
      setState("error");
      return;
    }

    setState("creating");
    try {
      const walletKeyId = await approveConnection({
        appName,
        redirectOrigin: redirectOrigin || "manual",
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
      setError(e instanceof Error ? e.message : "Failed to create connection");
      setState("error");
    }
  }, [redirectUri, redirectOrigin, appName, isManualMode, isOriginAllowed, approveConnection, finalizeConnection]);

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
  if (phase === "anonymous" || phase === "initializing") {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        {phase === "initializing" ? (
          <div className="text-muted-foreground">Loading...</div>
        ) : (
          <div className="flex flex-col items-center gap-6">
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-semibold">Sign in to continue</h1>
              <p className="text-muted-foreground">
                <strong>{appName}</strong> wants to connect to your OpenScholar wallet.
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
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md w-full space-y-6">
          <div className="text-center space-y-2">
            <div className="text-3xl">&#x2713;</div>
            <h1 className="text-2xl font-semibold">Connection Created</h1>
            <p className="text-muted-foreground">
              Copy this API key and paste it into <strong>{appName}</strong>.
              It will only be shown once.
            </p>
          </div>

          <div className="rounded-lg border p-4 space-y-3 bg-muted/30">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              API Key
            </label>
            <div className="flex gap-2">
              <code className="flex-1 rounded-md border bg-background px-3 py-2.5 text-sm font-mono break-all select-all">
                {generatedKey}
              </code>
              <button
                onClick={handleCopy}
                className="shrink-0 rounded-md border px-3 py-2.5 text-sm font-medium hover:bg-muted transition-colors"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
            This key grants access to AI generation using your credits.
            Store it securely. You can revoke it from Settings at any time.
          </div>

          <button
            onClick={() => window.close()}
            className="w-full rounded-lg border px-4 py-2.5 text-sm font-medium hover:bg-muted transition-colors"
          >
            Close this window
          </button>
        </div>
      </div>
    );
  }

  // ── Origin not allowed ──────────────────────────────────────
  if (!isManualMode && isOriginAllowed === false) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md w-full space-y-6 text-center">
          <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <span className="text-2xl">&#x26D4;</span>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">Origin Not Registered</h1>
            <p className="text-muted-foreground">
              The application at <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{redirectOrigin}</code> is
              not registered to connect to OpenScholar.
            </p>
          </div>
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-muted-foreground text-left space-y-2">
            <p className="font-medium text-foreground">What does this mean?</p>
            <p>
              Only pre-approved origins can create wallet connections. If you are the developer of <strong>{appName}</strong>,
              contact the OpenScholar team to register your origin.
            </p>
          </div>
          <button
            onClick={() => window.close()}
            className="w-full rounded-lg border px-4 py-2.5 text-sm font-medium hover:bg-muted transition-colors"
          >
            Close this window
          </button>
        </div>
      </div>
    );
  }

  // ── Consent screen ─────────────────────────────────────────
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold">Connect App</h1>
          <p className="text-muted-foreground">
            <strong>{appName}</strong> wants to use AI generation through your OpenScholar credits.
          </p>
        </div>

        <div className="rounded-lg border p-4 space-y-3 bg-muted/30">
          <div className="text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">App</span>
              <span className="font-medium">{appName}</span>
            </div>
            {!isManualMode && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Origin</span>
                <span className="font-mono text-xs">{redirectOrigin}</span>
              </div>
            )}
          </div>
          <div className="text-xs text-muted-foreground border-t pt-3">
            This app will be able to make AI generation requests using your credits.
            You can revoke access at any time from Settings.
          </div>
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
            {isManualMode ? "Cancel" : "Reject"}
          </button>
          <button
            onClick={handleApprove}
            disabled={state === "creating" || state === "done" || !canRunProtectedQueries || (!isManualMode && isOriginAllowed !== true)}
            className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {state === "creating"
              ? "Creating key..."
              : state === "done"
                ? "Redirecting..."
                : "Approve"}
          </button>
        </div>
      </div>
    </div>
  );
}
