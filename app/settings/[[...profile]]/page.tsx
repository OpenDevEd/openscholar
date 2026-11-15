"use client";

import { Suspense, startTransition, use, useState } from "react";
import { usePathname } from "next/navigation";
import { UserProfile, useReverification, useSession, useUser } from "@clerk/nextjs";
import { isReverificationCancelledError } from "@clerk/nextjs/errors";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { useFormatter, useLocale, useNow, useTranslations } from "next-intl";
import { CountryFlag } from "@/components/ui/country-flag";
import { countryCodeOf, getRegionDisplayName } from "@/lib/i18n/region-names";
import { BadgeCheck, Camera, Check, Loader2, LogOut, Monitor, Pencil, Smartphone, Tablet, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Enter, Paged, pagerOf } from "@/components/settings/parts";
import { ProfileSetupSettings, useProfileSetupReady } from "@/components/profile/profile-setup";
import { cn } from "@/lib/utils";
import { useWorkspaceHref } from "@/lib/workspaces/href";

/**
 * Profile and Security. Each opens with a summary drawn from Clerk's own data;
 * Clerk's component keeps its flows (edit name and photo, emails, password),
 * restyled as zones. It routes by path under /settings (`/security`).
 */
export default function Page() {
  const pathname = usePathname();
  // Profile and Security share this route; each gets its own entrance.
  return <ProfilePage key={pathname} security={pathname.endsWith("/security")} />;
}

function ProfilePage({ security }: { security: boolean }) {
  // Clerk's pages sit under the settings of the workspace the page is in.
  const settingsPath = useWorkspaceHref()("/settings");
  const [clerkReady, setClerkReady] = useState(false);
  // The profile setup's answers are drawn with the rest, not after it.
  const setupReady = useProfileSetupReady();
  const { user } = useUser();
  // The session request lives here, above the Suspense boundary: a component that
  // suspends before it commits loses its state, and would start a new request each try.
  const [sessions, setSessions] = useState<Promise<Sessions> | null>(null);
  if (security && user && sessions === null) setSessions(readSessions(user));
  // Clerk draws its sections after it loads. Watch for them (a DOM observer),
  // so the page appears once, whole, instead of growing after the fade.
  const watchClerk = (node: HTMLDivElement | null) => {
    if (!node) return;
    const found = () => {
      if (!node.querySelector(".cl-profileSection")) return false;
      setClerkReady(true);
      return true;
    };
    if (found()) return;
    const observer = new MutationObserver(() => found() && observer.disconnect());
    observer.observe(node, { childList: true, subtree: true });
    return () => observer.disconnect();
  };
  return (
    <Suspense fallback={<Enter ready={false}>{null}</Enter>}>
      <Enter ready={clerkReady && setupReady}>
        <div ref={watchClerk} className="space-y-8">
          {security ? (
            user && sessions ? (
              <SecurityOverview user={user} sessions={sessions} refresh={() => setSessions(readSessions(user))} />
            ) : (
              <div className="h-24" />
            )
          ) : (
            <Identity />
          )}
          {security ? null : <ProfileSetupSettings />}
          <UserProfile
            routing="path"
            path={settingsPath}
            appearance={{
              // The settings template owns the page entrance; Clerk's own would run on top of it.
              options: { animations: false },
              elements: {
                rootBox: { width: "100%" },
                cardBox: { height: "auto", overflow: "visible", width: "100%", maxWidth: "100%", boxShadow: "none", border: "none", borderRadius: 0, background: "transparent" },
                navbar: { display: "none" },
                navbarMobileMenuRow: { display: "none" },
                scrollBox: { height: "auto", overflow: "visible", background: "transparent", borderRadius: 0, boxShadow: "none", border: "none" },
                pageScrollBox: { overflow: "visible" },
                profilePageContent: { padding: 0 },
                // The rail already names the page.
                header: { display: "none" },
                page: { gap: "2rem" },
                profilePage: { gap: "2rem", paddingBottom: "4px" },
                // Name and photo are edited in the identity block above; devices are the timeline above.
                profileSection__profile: "!hidden",
                profileSection__activeDevices: "!hidden",
                // Each Clerk section becomes a zone: a small label over its rows. Clerk puts
                // the header after the content in the DOM, and shifts it with a transform.
                profileSection: "!flex !flex-col-reverse !gap-2.5 !border-0 !p-0",
                profileSectionHeader: "!m-0 !w-full !max-w-none !transform-none !ps-1 !py-0",
                profileSectionTitle: "!p-0",
                profileSectionTitleText: "!text-xs !font-medium !text-muted-foreground",
                profileSectionContent: "!rounded-2xl !border !border-border-subtle !bg-inset !px-4 !py-3",
                profileSectionPrimaryButton: "!text-primary",
                // Deleting the account reads as a danger zone.
                profileSection__danger:
                  "[&_.cl-profileSectionTitleText]:!text-destructive [&_.cl-profileSectionContent]:!border-destructive/30 [&_.cl-profileSectionContent]:!bg-destructive/5 [&_.cl-profileSectionPrimaryButton]:!text-destructive [&_.cl-profileSectionPrimaryButton:hover]:!bg-destructive/10",
                // Edit forms open inline, flat.
                actionCard: "!rounded-xl !border !border-border-subtle !bg-inset !shadow-none",
              },
            }}
          />
        </div>
      </Enter>
    </Suspense>
  );
}

/** Your photo and name, edited in place through Clerk. */
function Identity() {
  const t = useTranslations("settingsProfile");
  const tc = useTranslations("common");
  const { user } = useUser();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ first: "", last: "" });
  const [saving, setSaving] = useState<"name" | "photo" | null>(null);
  if (!user) return <div className="h-24" />;

  const startEditing = () => {
    setDraft({ first: user.firstName ?? "", last: user.lastName ?? "" });
    setEditing(true);
  };
  const saveName = async () => {
    setSaving("name");
    try {
      await user.update({ firstName: draft.first.trim(), lastName: draft.last.trim() });
      setEditing(false);
    } finally {
      setSaving(null);
    }
  };
  const savePhoto = async (file: File | undefined) => {
    if (!file) return;
    setSaving("photo");
    try {
      await user.setProfileImage({ file });
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="flex items-center gap-6">
      <label className="group relative size-24 shrink-0 cursor-pointer overflow-hidden rounded-3xl border border-border-subtle">
        <img src={user.imageUrl} alt="" className="size-full object-cover" />
        <span
          className={cn(
            "absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 text-xs font-medium text-white transition-opacity",
            saving === "photo" ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
          )}
        >
          {saving === "photo" ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}
          {saving === "photo" ? t("uploading") : t("changePhoto")}
        </span>
        <input type="file" accept="image/*" className="sr-only" aria-label={t("changePhoto")} onChange={(e) => savePhoto(e.target.files?.[0])} />
      </label>

      <div className="min-w-0 flex-1 space-y-2">
        {editing ? (
          <form
            // On a phone the two names keep room to be read: the buttons go to the next line.
            className="flex max-w-xl flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void saveName();
            }}
          >
            <Input autoFocus aria-label={t("firstName")} value={draft.first} onChange={(e) => setDraft((d) => ({ ...d, first: e.target.value }))} className="h-10 min-w-32 flex-1" />
            <Input aria-label={t("lastName")} value={draft.last} onChange={(e) => setDraft((d) => ({ ...d, last: e.target.value }))} className="h-10 min-w-32 flex-1" />
            <Button type="submit" size="icon" className="size-10 shrink-0" disabled={saving === "name"} aria-label={t("saveName")}>
              {saving === "name" ? <Loader2 className="animate-spin" /> : <Check />}
            </Button>
            <Button type="button" variant="ghost" size="icon" className="size-10 shrink-0" onClick={() => setEditing(false)} aria-label={tc("cancel")}>
              <X />
            </Button>
          </form>
        ) : (
          <button type="button" onClick={startEditing} className="group flex max-w-full items-center gap-2 text-start" aria-label={t("editName")}>
            <span className="truncate text-3xl font-semibold tracking-tight">{user.fullName || t("addYourName")}</span>
            <Pencil className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
          </button>
        )}
        {/* A long address is cut to the phone's width instead of widening the page; its full text is in the email card below. */}
        <p className="inline-flex max-w-full items-center gap-1.5 text-sm">
          <span dir="ltr" className="min-w-0 truncate">{user.primaryEmailAddress?.emailAddress}</span>
          {user.primaryEmailAddress?.verification?.status === "verified" ? (
            <BadgeCheck className="size-4 text-success" aria-label={t("verified")} />
          ) : null}
        </p>
      </div>
    </section>
  );
}

type Device = "desktop" | "mobile" | "tablet";
const DEVICE_ICON = { desktop: Monitor, mobile: Smartphone, tablet: Tablet };
const deviceOf = (type?: string, mobile?: boolean): Device =>
  mobile ? "mobile" : type?.toLowerCase().includes("tablet") || type?.toLowerCase().includes("ipad") ? "tablet" : "desktop";

type ClerkUser = NonNullable<ReturnType<typeof useUser>["user"]>;
type Sessions = Awaited<ReturnType<ClerkUser["getSessions"]>>;
const DEVICES_PER_PAGE = 6;

/** Clerk's SDK caches the session list on the user; reloading the user reads it again. */
function readSessions(user: ClerkUser): Promise<Sessions> {
  return user
    .reload()
    .then((fresh) => fresh.getSessions())
    .catch((error: unknown): Sessions => {
      // The page still renders, with the devices missing, if Clerk can't answer.
      console.error("[settings] couldn't read sessions", error);
      return [];
    });
}

/**
 * Where you're signed in, as a timeline. Sessions from the same browser,
 * platform and place collapse into one device, newest first.
 */
function SecurityOverview({ user, sessions: sessionsPromise, refresh }: { user: ClerkUser; sessions: Promise<Sessions>; refresh: () => void }) {
  const t = useTranslations("settingsProfile");
  const tc = useTranslations("common");
  // Clerk asks the user to verify again before signing out other devices from an older session.
  const revoke = useReverification((targets: Sessions) => Promise.all(targets.map((s) => s.revoke())));
  const { session: current } = useSession();
  const format = useFormatter();
  const locale = useLocale();
  const now = useNow({ updateInterval: 60_000 });
  // Sessions Clerk has confirmed revoked leave the list at once, before the next read.
  const [revoked, setRevoked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const sessions = use(sessionsPromise).filter((s) => s.status === "active" && !revoked.has(s.id));

  type Entry = { key: string; sessions: Sessions; here: boolean; last: Date; title: string; place: string; country: string | null; ip?: string; device: Device };
  const entries = new Map<string, Entry>();
  for (const s of sessions) {
    const a = s.latestActivity;
    const here = s.id === current?.id;
    // Clerk names the country by its code or its name; either way it shows with its flag and its name in the page's language.
    const country = countryCodeOf(a?.country);
    const place = [a?.city, country ? getRegionDisplayName(country, locale) : a?.country].filter(Boolean).join(", ");
    const key = here ? "here" : `${a?.browserName}|${a?.deviceType}|${place}`;
    const e = entries.get(key);
    if (e) {
      e.sessions.push(s);
      if (s.lastActiveAt > e.last) e.last = s.lastActiveAt;
    } else {
      const platform = a?.deviceType === "X11" ? "Linux" : a?.deviceType;
      entries.set(key, {
        key, sessions: [s], here, last: s.lastActiveAt, place, country, ip: a?.ipAddress,
        title: platform
          ? t("browserOn", { browser: a?.browserName ?? t("aBrowser"), platform })
          : (a?.browserName ?? t("aBrowser")),
        device: deviceOf(a?.deviceType, a?.isMobile),
      });
    }
  }
  const list = [...entries.values()].sort((a, b) => (a.here ? -1 : b.here ? 1 : b.last.getTime() - a.last.getTime()));
  const pager = pagerOf(list.length, DEVICES_PER_PAGE, page, setPage);
  const shown = list.slice((pager.page - 1) * pager.size, pager.page * pager.size);
  const others = sessions.filter((s) => s.id !== current?.id);

  /**
   * Revokes Clerk sessions, then reads the list again. A transition keeps the
   * current list on screen until the new one arrives.
   */
  const signOut = async (key: string, targets: () => Promise<Sessions>) => {
    setBusy(key);
    try {
      const done = await revoke(await targets());
      setRevoked((set) => new Set([...set, ...done.map((s) => s.id)]));
    } catch (error) {
      if (!isReverificationCancelledError(error)) {
        console.error("[settings] sign-out failed", error);
        toast.error(getErrorMessage(error, tc("somethingWentWrong")));
      }
    } finally {
      setBusy(null);
      startTransition(refresh);
    }
  };

  return (
    <section className="space-y-5">
      {/* On a phone the button wraps under the heading instead of squeezing it. */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <h2 className="text-lg font-semibold">{t("whereSignedIn")}</h2>
        {others.length > 0 ? (
          <Button variant="outline" disabled={busy !== null} onClick={() =>
              // Read the sessions again, so ones that started after this page opened are signed out too.
              signOut("others", async () => (await readSessions(user)).filter((s) => s.status === "active" && s.id !== current?.id))
            }>
            {busy === "others" ? <Loader2 className="animate-spin" /> : <LogOut />} {t("signOutEverywhereElse")}
          </Button>
        ) : null}
      </div>

      <Paged pager={pager} rowHeight={66} label={t("devices")}>
        <ol className="relative">
          {/* The rail the devices hang from. */}
          <span aria-hidden className="absolute bottom-6 start-5 top-6 w-px bg-border sm:start-[6.75rem]" />
          {shown.map((e) => {
            const Icon = DEVICE_ICON[e.device];
            return (
              // On a phone the time column goes under the device's name, so the name keeps room to be read.
              <li key={e.key} className="group relative grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 py-2 sm:grid-cols-[5.5rem_2.5rem_minmax(0,1fr)_auto]">
                <span className={cn("hidden text-end text-xs tabular-nums sm:block", e.here ? "font-medium text-primary" : "text-muted-foreground")}>
                  {e.here ? t("now") : format.relativeTime(e.last, now)}
                </span>
                <span
                  className={cn(
                    "relative z-10 mt-1.5 flex size-10 items-center justify-center self-start rounded-xl ring-4 ring-background",
                    e.here ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 rounded-xl px-3 py-2 transition-colors group-hover:bg-muted">
                  <p className="flex items-center gap-2 truncate text-sm font-medium">
                    {e.title}
                    {e.here ? <span className="text-xs font-normal text-primary">{t("thisDevice")}</span> : null}
                  </p>
                  <p className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
                    <span className={cn("shrink-0 tabular-nums sm:hidden", e.here && "font-medium text-primary")}>{e.here ? t("now") : format.relativeTime(e.last, now)}</span>
                    {e.place ? <span className="flex min-w-0 items-center gap-1.5">{e.country ? <CountryFlag countryCode={e.country} className="shrink-0" /> : null}<span className="truncate">{e.place}</span></span> : null}
                    {e.ip ? <span className="font-mono text-2xs text-muted-foreground/70">{e.ip}</span> : null}
                  </p>
                </div>
                {e.here ? (
                  <span className="w-24" />
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy !== null}
                    className={cn(
                      "w-24 text-muted-foreground transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100",
                      busy === e.key ? "opacity-100" : "opacity-0",
                    )}
                    onClick={() => signOut(e.key, async () => e.sessions)}
                  >
                    {busy === e.key ? <Loader2 className="animate-spin" /> : null}
                    {t("signOut")}
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      </Paged>
    </section>
  );
}
