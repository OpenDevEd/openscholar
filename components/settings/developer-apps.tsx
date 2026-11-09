"use client";

// Apps people build on Openscholar, on the connections page: each signs people in with
// Openscholar's sign-in and calls Convex as them (convex/developerApps).

import { useState, type ReactNode } from "react";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion } from "motion/react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { AppWindow, Check, ChevronRight, Copy, Globe, Lock, Plus, RefreshCw, Server, Trash2, X } from "@/components/icons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TooltipHint } from "@/components/ui/tooltip";
import { AutoHeight } from "@/components/ui/auto-height";
import { LIST, Paged, Segmented, Tile, Working, Zone } from "@/components/settings/parts";
import { EASE } from "@/components/settings/model-map";
import type { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { getErrorMessage, useAppToast } from "@/lib/toast/use-app-toast";

type DevApp = FunctionReturnType<typeof api.developerApps.apps.listApps>["page"][number];
type Kind = DevApp["kind"];
/** What the credentials and setup steps are filled in from: a listed app, or one just made. */
type AppKeys = Pick<DevApp, "name" | "website" | "redirectUris" | "kind" | "clientId">;
type Draft = { name: string; website: string; redirectUris: string[]; kind: Kind };
type AppsPage = ReturnType<typeof useCursorPage<typeof api.developerApps.apps.listApps>>;

export const APPS_PER_PAGE = 8;
/** As many apps as one person makes (MAX_APPS in convex/developerApps/apps.ts). */
const MAX_APPS = 10;
const MAX_REDIRECT_URIS = 5;
const TINTS = ["#a78bfa", "#60a5fa", "#34d399", "#f472b6", "#2dd4bf", "#d9a27c"];

/** Where Clerk signs people in: the publishable key holds the instance's frontend address. */
function issuer() {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  try {
    return `https://${atob(key.split("_")[2] ?? "").replace(/\$$/, "")}`;
  } catch {
    return "";
  }
}
const API = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
const validUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || (parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname));
  } catch {
    return false;
  }
};

export function DeveloperApps({ apps, count }: { apps: AppsPage; count: number }) {
  const t = useTranslations("developerApps");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<Id<"developerApps"> | null>(null);
  const full = count >= MAX_APPS;
  const opened = apps.items.find((app) => app._id === openId) ?? null;

  const newApp = (
    <Button size="sm" className="h-7" disabled={full} onClick={() => setCreating(true)}>
      <Plus /> {t("newApp")}
    </Button>
  );

  return (
    <Zone
      label={t("yourApps")}
      aside={full ? (
        <TooltipHint label={t("limit", { count: MAX_APPS })}>
          <span tabIndex={0}>{newApp}</span>
        </TooltipHint>
      ) : newApp}
    >
      {apps.items.length === 0 && !apps.hasPages ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
          <AppWindow className="size-5 text-muted-foreground" />
          <p className="text-sm font-medium">{t("noApps")}</p>
          <p className="max-w-sm text-xs text-muted-foreground">{t("noAppsDescription")}</p>
        </div>
      ) : (
        <Paged pager={{ list: apps, size: APPS_PER_PAGE, total: count }} rowHeight={61} label={t("apps")}>
          <ul key={apps.page} className={`${LIST} @container/apps`}>
            <AnimatePresence initial={false}>
              {apps.items.map((app, i) => (
                <motion.li
                  key={app._id}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: EASE }}
                >
                  <button
                    type="button"
                    onClick={() => setOpenId(app._id)}
                    className="flex w-full items-center gap-3 p-3 text-start transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                  >
                    <Tile icon={AppWindow} tint={TINTS[(apps.offset + i) % TINTS.length]!} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{app.name}</span>
                      <span className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <Globe className="size-3 shrink-0" />
                          <span className="truncate">{host(app.website)}</span>
                        </span>
                        <span className="shrink-0 font-mono text-2xs @max-[30rem]/apps:hidden">{app.clientId}</span>
                      </span>
                    </span>
                    <KindTag kind={app.kind} />
                    <span className="shrink-0 whitespace-nowrap text-end text-xs tabular-nums text-muted-foreground @max-[36rem]/apps:hidden">
                      {t("created", { time: format.relativeTime(Math.min(app._creationTime, now.getTime()), now) })}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </Paged>
      )}

      <NewAppDialog open={creating} onOpenChange={setCreating} />
      <AppDialog app={opened} onClose={() => setOpenId(null)} />
    </Zone>
  );
}

function KindTag({ kind }: { kind: Kind }) {
  const t = useTranslations("developerApps");
  const Icon = kind === "server" ? Server : Globe;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
      <Icon className="size-3" />
      {kind === "server" ? t("kindServer") : t("kindBrowser")}
    </span>
  );
}

/** Creating an app: its details, then its credentials (the secret only this once) and how to set it up. */
function NewAppDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("developerApps");
  const tc = useTranslations("common");
  const toast = useAppToast();
  const createApp = useAction(api.developerApps.actions.createApp);
  const [draft, setDraft] = useState<Draft>({ name: "", website: "", redirectUris: [""], kind: "browser" });
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ app: AppKeys; secret: string | null } | null>(null);
  const reset = () => {
    setDraft({ name: "", website: "", redirectUris: [""], kind: "browser" });
    setCreated(null);
  };
  const create = async () => {
    const details = { name: draft.name, website: draft.website, redirectUris: draft.redirectUris.filter(Boolean) };
    setBusy(true);
    try {
      const { clientId, clientSecret } = await createApp({ ...details, kind: draft.kind });
      setCreated({ app: { ...details, kind: draft.kind, clientId }, secret: clientSecret });
    } catch (error) {
      toast.error(getErrorMessage(error, tc("somethingWentWrong")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className={created ? "sm:max-w-2xl" : "sm:max-w-lg"}>
        {/* The dialog is a grid, and a grid item is as wide as an unbroken name without min-w-0: the name wraps instead. */}
        <DialogHeader className="min-w-0">
          <DialogTitle className="wrap-anywhere">{created ? created.app.name : t("newApp")}</DialogTitle>
        </DialogHeader>
        <AutoHeight className="min-w-0">
          {created ? (
            <div className="space-y-6">
              <Credentials app={created.app} secret={created.secret} />
              <SetupGuide app={created.app} />
            </div>
          ) : (
            <form
              id="new-app"
              className="flex flex-col gap-5"
              onSubmit={(event) => {
                event.preventDefault();
                if (ready(draft) && !busy) void create();
              }}
            >
              <AppFields draft={draft} onChange={setDraft} />
            </form>
          )}
        </AutoHeight>
        <DialogFooter>
          {created ? (
            <Button onClick={() => { onOpenChange(false); reset(); }}>{t("done")}</Button>
          ) : (
            <>
              <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
              <Button type="submit" form="new-app" className="relative" disabled={!ready(draft) || busy}>
                <Working busy={busy}>{t("create")}</Working>
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ready = (draft: Draft) =>
  draft.name.trim().length > 0 && validUrl(draft.website) && draft.redirectUris.some(Boolean) && draft.redirectUris.every((uri) => !uri || validUrl(uri));

/** The details an app is made from, and the line people see when they're asked to allow it. */
function AppFields({ draft, onChange, kindFixed = false }: { draft: Draft; onChange: (draft: Draft) => void; kindFixed?: boolean }) {
  const t = useTranslations("developerApps");
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const firstRedirect = draft.redirectUris.find((uri) => validUrl(uri));
  return (
    <>
      <Field label={t("name")} htmlFor="app-name">
        <Input id="app-name" autoFocus value={draft.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} placeholder="BeeWriter" className="h-11 rounded-xl" />
      </Field>
      <Field label={t("website")} htmlFor="app-website" error={draft.website && !validUrl(draft.website) ? t("badUrl") : null}>
        <Input id="app-website" type="url" value={draft.website} onChange={(e) => set({ website: e.target.value })} placeholder="https://beewriter.app" className="h-11 rounded-xl" />
      </Field>
      <Field label={t("redirectUrls")} error={draft.redirectUris.some((uri) => uri && !validUrl(uri)) ? t("badUrl") : null}>
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {draft.redirectUris.map((uri, index) => (
              <motion.div key={index} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: EASE }} className="overflow-clip [overflow-clip-margin:4px]">
                <div className="flex items-center gap-2">
                  <Input
                    type="url"
                    aria-label={t("redirectUrl", { number: index + 1 })}
                    value={uri}
                    onChange={(e) => set({ redirectUris: draft.redirectUris.map((old, i) => (i === index ? e.target.value : old)) })}
                    placeholder="https://beewriter.app/auth/callback"
                    className="h-11 rounded-xl font-mono"
                  />
                  {draft.redirectUris.length > 1 ? (
                    <TooltipHint label={t("removeUrl")}>
                      <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0 text-muted-foreground" aria-label={t("removeUrl")} onClick={() => set({ redirectUris: draft.redirectUris.filter((_, i) => i !== index) })}>
                        <X />
                      </Button>
                    </TooltipHint>
                  ) : null}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {draft.redirectUris.length < MAX_REDIRECT_URIS ? (
            <Button type="button" variant="ghost" size="sm" className="h-7 text-muted-foreground" onClick={() => set({ redirectUris: [...draft.redirectUris, ""] })}>
              <Plus /> {t("addUrl")}
            </Button>
          ) : null}
        </div>
      </Field>
      <Field label={t("kind")}>
        {kindFixed ? (
          <div className="flex items-center gap-2 text-sm">
            <KindTag kind={draft.kind} />
            <span className="text-xs text-muted-foreground">{t("kindFixed")}</span>
          </div>
        ) : (
          <Segmented
            fill
            size="md"
            label={t("kind")}
            value={draft.kind}
            onChange={(kind) => set({ kind })}
            options={[
              { id: "browser", label: t("kindBrowserLong"), icon: Globe, below: <span className="text-2xs text-muted-foreground">{t("kindBrowserHint")}</span> },
              { id: "server", label: t("kindServerLong"), icon: Server, below: <span className="text-2xs text-muted-foreground">{t("kindServerHint")}</span> },
            ]}
          />
        )}
      </Field>
      {/* What the sign-in page will say, from what's typed above. */}
      <div className="flex items-center gap-3 rounded-xl bg-muted/50 px-3 py-2.5">
        <Tile icon={AppWindow} tint={TINTS[0]!} className="size-8" />
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          <span className="block truncate font-semibold text-foreground">{t("consentLine", { name: draft.name.trim() || t("yourApp") })}</span>
          <span className="block truncate">{t("consentReturn", { host: firstRedirect ? host(firstRedirect) : "…" })}</span>
        </p>
      </div>
    </>
  );
}

function Field({ label, htmlFor, error, children }: { label: string; htmlFor?: string; error?: string | null; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="ps-1 text-xs font-medium text-muted-foreground">{label}</label>
      {children}
      {error ? <p role="alert" className="ps-1 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

/** An app opened from the list: how to set it up, and its settings. */
function AppDialog({ app, onClose }: { app: DevApp | null; onClose: () => void }) {
  const t = useTranslations("developerApps");
  const tc = useTranslations("common");
  const toast = useAppToast();
  const updateApp = useAction(api.developerApps.actions.updateApp);
  const deleteApp = useAction(api.developerApps.actions.deleteApp);
  const newSecret = useAction(api.developerApps.actions.newSecret);
  const [tab, setTab] = useState<"setup" | "settings">("setup");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<"save" | "delete" | "secret" | null>(null);
  const [openedId, setOpenedId] = useState<Id<"developerApps"> | null>(null);
  // A different app starts on its setup, with nothing typed and no secret showing.
  if (app && app._id !== openedId) {
    setOpenedId(app._id);
    setTab("setup");
    setDraft({ name: app.name, website: app.website, redirectUris: app.redirectUris, kind: app.kind });
    setSecret(null);
    setConfirmDelete(false);
  }
  const changed = app && draft && JSON.stringify(draft) !== JSON.stringify({ name: app.name, website: app.website, redirectUris: app.redirectUris, kind: app.kind });
  const run = async (step: "save" | "delete" | "secret", call: () => Promise<void>) => {
    setBusy(step);
    try {
      await call();
    } catch (error) {
      toast.error(getErrorMessage(error, tc("somethingWentWrong")));
    } finally {
      setBusy(null);
    }
  };
  const close = () => {
    onClose();
    setOpenedId(null);
  };

  return (
    <Dialog open={Boolean(app)} onOpenChange={(next) => { if (!next && !busy) close(); }}>
      <DialogContent className="sm:max-w-2xl">
        {app && draft ? (
          <>
            {/* min-w-0: the dialog is a grid, and a grid item is as wide as its truncated title's whole text without it,
                which pushed the credentials past the screen at 200% text or with a long name. Where the title can't
                keep 6rem beside the tile and the kind, it takes its own line. */}
            <DialogHeader className="min-w-0 flex-row flex-wrap items-center gap-3 pe-8 text-start">
              <Tile icon={AppWindow} tint={TINTS[0]!} />
              <div className="min-w-24 flex-1">
                <DialogTitle className="truncate leading-snug">{app.name}</DialogTitle>
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Globe className="size-3 shrink-0" />
                  <span className="truncate">{host(app.website)}</span>
                </p>
              </div>
              <KindTag kind={app.kind} />
            </DialogHeader>
            <Segmented
              // Settings takes a second line where both don't fit (200% text, longer languages) instead of widening the
              // dialog. The radius is half the row's height, so one line looks as before.
              className="self-start flex-wrap rounded-[1.25rem]"
              label={t("view")}
              value={tab}
              onChange={setTab}
              options={[
                { id: "setup", label: t("setup") },
                { id: "settings", label: t("settings") },
              ]}
            />
            <AutoHeight className="min-w-0">
              {tab === "setup" ? (
                <div className="space-y-6">
                  <Credentials
                    app={app}
                    secret={secret}
                    newSecretBusy={busy === "secret"}
                    onNewSecret={app.kind === "server" ? () => run("secret", async () => setSecret(await newSecret({ appId: app._id }))) : undefined}
                  />
                  <SetupGuide app={app} />
                </div>
              ) : (
                <form
                  id="app-settings"
                  className="flex flex-col gap-5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!ready(draft) || busy) return;
                    void run("save", async () => {
                      await updateApp({ appId: app._id, name: draft.name, website: draft.website, redirectUris: draft.redirectUris.filter(Boolean) });
                    });
                  }}
                >
                  <AppFields draft={draft} onChange={setDraft} kindFixed />
                  {/* Where the text can't keep 6rem beside the buttons (200% text), the buttons take their own line. */}
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle px-3 py-2.5">
                    <p className="min-w-24 flex-1 text-xs text-muted-foreground">
                      <span className="block text-sm font-medium text-foreground">{t("deleteApp")}</span>
                      {t("deleteAbout")}
                    </p>
                    <div className="flex max-w-full flex-wrap items-center gap-1">
                      {confirmDelete ? (
                        <>
                          <Button type="button" variant="ghost" size="sm" disabled={busy === "delete"} onClick={() => setConfirmDelete(false)}>{t("cancel")}</Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            className="relative"
                            disabled={busy === "delete"}
                            onClick={() => run("delete", async () => {
                              await deleteApp({ appId: app._id });
                              close();
                            })}
                          >
                            <Working busy={busy === "delete"}>{t("delete")}</Working>
                          </Button>
                        </>
                      ) : (
                        <Button type="button" variant="outline" size="sm" className="text-destructive" onClick={() => setConfirmDelete(true)}>
                          <Trash2 /> {t("delete")}
                        </Button>
                      )}
                    </div>
                  </div>
                </form>
              )}
            </AutoHeight>
            {tab === "settings" ? (
              <DialogFooter>
                <Button type="submit" form="app-settings" className="relative" disabled={!changed || !ready(draft) || busy === "save"}>
                  <Working busy={busy === "save"}>{t("save")}</Working>
                </Button>
              </DialogFooter>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** The client ID, and for an app with a server its secret: shown once when made, or when a new one replaces it. */
function Credentials({ app, secret, onNewSecret, newSecretBusy = false }: { app: AppKeys; secret: string | null; onNewSecret?: () => void; newSecretBusy?: boolean }) {
  const t = useTranslations("developerApps");
  return (
    <div className={LIST}>
      <CopyRow label={t("clientId")} value={app.clientId} />
      {app.kind === "server" ? (
        secret ? (
          <CopyRow label={t("clientSecret")} value={secret} note={t("secretOnce")} />
        ) : (
          <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">{t("clientSecret")}</p>
              <p className="flex items-center gap-1 text-sm text-muted-foreground">
                <Lock className="size-3.5 shrink-0" /> {t("secretHidden")}
              </p>
            </div>
            {onNewSecret ? (
              <Button variant="outline" size="sm" className="relative" disabled={newSecretBusy} onClick={onNewSecret}>
                <Working busy={newSecretBusy}>
                  <span className="inline-flex items-center gap-1.5">
                    <RefreshCw /> {t("newSecret")}
                  </span>
                </Working>
              </Button>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  );
}

function CopyRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate font-mono text-sm">{value}</p>
        {note ? <p className="text-xs text-amber-700 dark:text-amber-400">{note}</p> : null}
      </div>
      <CopyButton value={value} label={label} />
    </div>
  );
}

function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const t = useTranslations("developerApps");
  const [copied, setCopied] = useState(false);
  return (
    <TooltipHint label={t("copy")}>
      <Button
        variant="ghost"
        size="icon"
        className={`size-8 shrink-0 text-muted-foreground ${className ?? ""}`}
        aria-label={t("copyLabel", { label })}
        onClick={() => {
          void navigator.clipboard?.writeText(value).catch(() => undefined);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={String(copied)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
          </motion.span>
        </AnimatePresence>
      </Button>
    </TooltipHint>
  );
}

/** Code to copy, laid out on the first frame (no highlighter that arrives later). */
function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="relative min-w-0 rounded-xl border border-border-subtle bg-muted/40">
      <pre className="overflow-x-auto py-3 ps-3.5 pe-12 font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
      <CopyButton value={code} label={label} className="absolute end-1.5 top-1.5 bg-background/80" />
    </div>
  );
}

/** The four steps to sign people in and call Openscholar, with this app's own values filled in. */
function SetupGuide({ app }: { app: AppKeys }) {
  const t = useTranslations("developerApps");
  const redirect = app.redirectUris[0] ?? "";
  const server = app.kind === "server";
  const challenge = [
    "const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\\+/g, \"-\").replace(/\\//g, \"_\").replace(/=+$/, \"\");",
    "const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));",
    "const challenge = base64url(new Uint8Array(await crypto.subtle.digest(\"SHA-256\", new TextEncoder().encode(verifier))));",
  ];
  const authorize = (go: string) => [
    `${go}("${issuer()}/oauth/authorize?" + new URLSearchParams({`,
    "  response_type: \"code\",",
    `  client_id: "${app.clientId}",`,
    `  redirect_uri: "${redirect}",`,
    "  scope: \"openid email profile offline_access\",",
    `  resource: "${API}",`,
    "  code_challenge: challenge,",
    "  code_challenge_method: \"S256\",",
    "}));",
  ];
  const token = (name: string, grant: string[]) => [
    `const ${name} = await fetch("${issuer()}/oauth/token", {`,
    "  method: \"POST\",",
    "  body: new URLSearchParams({",
    ...grant,
    `    client_id: "${app.clientId}",`,
    ...(server ? ["    client_secret: process.env.OPENSCHOLAR_CLIENT_SECRET,"] : []),
    `    resource: "${API}",`,
    "  }),",
    "}).then((response) => response.json());",
  ];
  const steps: { title: string; about: string; code: string }[] = [
    {
      title: t("step1"),
      about: t("step1About"),
      code: (server
        ? ["// On your server", ...challenge, "request.session.openscholarVerifier = verifier;", "", ...authorize("response.redirect")]
        : [...challenge, "sessionStorage.setItem(\"openscholar_verifier\", verifier);", "", ...authorize("location.assign")]
      ).join("\n"),
    },
    {
      title: t("step2"),
      about: server ? t("step2AboutServer") : t("step2AboutBrowser"),
      code: [
        ...(server ? ["// On your server, at the redirect URL"] : []),
        ...token("tokens", [
          "    grant_type: \"authorization_code\",",
          server ? "    code: request.query.code," : "    code: new URL(location.href).searchParams.get(\"code\"),",
          `    redirect_uri: "${redirect}",`,
          server ? "    code_verifier: request.session.openscholarVerifier," : "    code_verifier: sessionStorage.getItem(\"openscholar_verifier\"),",
        ]),
        "// tokens.access_token, tokens.refresh_token",
      ].join("\n"),
    },
    {
      title: t("step3"),
      about: t("step3About"),
      code: [
        "import { ConvexHttpClient } from \"convex/browser\";",
        "import { anyApi } from \"convex/server\";",
        "",
        `const openscholar = new ConvexHttpClient("${API}");`,
        "openscholar.setAuth(tokens.access_token);",
        "",
        "// Makes the person's Openscholar account the first time they sign in.",
        "await openscholar.mutation(anyApi.users.mutations.ensureUser, {});",
        "const workspaceId = await openscholar.query(anyApi.workspaces.queries.personal, {});",
        "await openscholar.action(anyApi.library.papers.save, { workspaceId, id: \"W2741809807\" });",
      ].join("\n"),
    },
    {
      title: t("step4"),
      about: t("step4About"),
      code: [
        ...token("refreshed", ["    grant_type: \"refresh_token\",", "    refresh_token: tokens.refresh_token,"]),
        "// refreshed.access_token. Keep refreshed.refresh_token if one comes back, or the old one if not.",
      ].join("\n"),
    },
  ];
  return (
    <section className="space-y-2.5">
      <h3 className="ps-1 text-xs font-medium text-muted-foreground">{t("setupTitle")}</h3>
      <ol className="space-y-5">
        {steps.map((step, index) => (
          <li key={step.title} className="min-w-0 space-y-2">
            <div className="flex gap-2.5 ps-1">
              <span className="w-4 shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">{index + 1}</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{step.title}</p>
                <p className="text-xs text-muted-foreground">{step.about}</p>
              </div>
            </div>
            <CodeBlock code={step.code} label={step.title} />
          </li>
        ))}
      </ol>
      <p className="ps-1 text-xs text-muted-foreground">{t("cantDo")}</p>
    </section>
  );
}
