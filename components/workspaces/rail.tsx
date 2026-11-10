"use client";

// The app sidebar (#651): one slim rail that holds only what no page shows. Where you are (the
// workspace, tinting the rail), the way between sections, and what's happening elsewhere: a
// running screening or extraction fills a ring around its icon and its label becomes the
// progress, so it's visible from any page. Everything a page already lists stays on that page.

import React, { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth, useClerk, useUser } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { showStyledToast } from "@/components/ui/sonner";
import { useTheme } from "next-themes";
import { useFormatter, useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AiIcon,
  BillingIcon,
  BookmarksIcon,
  EvidenceLibrariesIcon,
  ExploreIcon,
  ExtractionIcon,
  HistoryIcon,
  LibraryIcon,
  PublishIcon,
  ListChecks,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  Search,
  SettingsIcon,
  Share2,
  Sun,
  type AppIcon,
  UpgradeIcon,
} from "@/components/icons";
import { SHEET_SPRING as CARD_SPRING } from "@/lib/motion";
import { KeywordExpansionPreview } from "@/components/keyword-expansion-preview";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useQueryHighlight } from "@/components/query-highlight";
import { Switch } from "@/components/ui/switch";
import { LogoMark } from "@/components/logo";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { EASE } from "@/components/settings/model-map";
import { Segmented } from "@/components/settings/parts";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import Link from "@/components/workspace-link";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useWorkspaceFeatures } from "@/lib/workspaces/use-workspace-features";
import { useFeatureFlag, useFeatureFlagForPlan, useSeatBilling } from "@/lib/feature-flags/hook";
import { TEAM_PLAN } from "@/lib/billing/plans";
import { useSignInRedirect } from "@/lib/auth/use-sign-in-redirect";
import { useSubscriptionState } from "@/lib/auth/use-subscription-state";
import { findPlan, mainPlans } from "@/lib/billing/catalog";
import { useQueryShortcuts } from "@/lib/research/reads";
import { useCurrentQueryStore, useKeywordExpansionStore } from "@/lib/store";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";
import { bareWorkspacePath, switchTarget } from "@/lib/workspaces/paths";
import { inWorkspace, useWorkspace } from "@/lib/workspaces/url";
import { useWorkspaceSlug } from "@/lib/workspaces/href";
import { LOOK_COOKIE, lookCookieIn, lookKey, readCache, writeCache, type CachedLook, type CachedMe, type FirstWorkspace } from "@/lib/workspaces/look-cache";
import { CreateOrganization, WorkspaceMenu } from "./switcher";
import { Framed, Opening, settingsHref, usePlanOf, useCurrentWorkspace, useWorkspaces, workspaceTint, WorkspaceTile, type WorkspaceLook, type WorkspaceRow } from "./parts";

/** How far the rail steps back while a card is up. */
const RECEDE = 0.9;
const SLIDE = { type: "spring" as const, stiffness: 520, damping: 42, mass: 0.7 };

/** The raised surface of the section you're on. */
const RAISED = "bg-card shadow-[0_1px_2px_rgb(0_0_0/0.06),0_0_0_1px_rgb(0_0_0/0.05)] dark:shadow-[0_0_0_1px_rgb(255_255_255/0.06)]";

/** A ring around a section's icon for its running job: a faint track and the done share in primary. */
function ProgressRing({ value }: { value: number }) {
  const circumference = 2 * Math.PI * 10;
  return (
    <svg viewBox="0 0 24 24" className="pointer-events-none absolute inset-0 size-full" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10.5" stroke="currentColor" strokeWidth="1" opacity="0.12" />
      <circle
        cx="12"
        cy="12"
        r="10.5"
        stroke="var(--primary)"
        strokeWidth="1.25"
        strokeDasharray={circumference}
        strokeDashoffset={circumference - (circumference * value) / 100}
        strokeLinecap="round"
        transform="rotate(-90 12 12)"
        className="transition-[stroke-dashoffset] duration-500 ease-out"
      />
    </svg>
  );
}

/** A year: how long the browser keeps the rail's looks. */
const LOOK_KEPT_S = 365 * 24 * 60 * 60;

/**
 * How the rail looked last time in this browser, for the person and the address's workspace:
 * what the server drew the page with (`first`), then the cookie as the address changes. Nothing
 * once Clerk says no one's signed in. Clerk loads in the browser, after the server and the first
 * frame; until then the server's word on who's signed in stands. The browser's cookie isn't read
 * until the rail has hydrated: it can change after the request went, when the page before or
 * another tab writes it, and a first render that differs from the server's fails hydration.
 */
function cachedRail(first: FirstWorkspace, slug: string | null, auth: { isLoaded: boolean; userId: string | null | undefined }, hydrated: boolean): { me?: CachedMe; look?: CachedLook } {
  const user = auth.isLoaded ? auth.userId : first.user;
  if (!user) return {};
  // On the server, and as the rail hydrates, the cookie is the request's, which `first` already read for its account.
  if (slug === first.slug && first.user === user && (first.look || !hydrated)) return first;
  if (!hydrated) return {};
  const { me, looks } = readCache(lookCookieIn(document.cookie), user);
  return { ...(me ? { me } : {}), ...(looks[lookKey(slug)] ? { look: looks[lookKey(slug)] } : {}) };
}

export function SidebarContent({ firstWorkspace, onClose }: { firstWorkspace: FirstWorkspace; onClose?: () => void }) {
  const t = useTranslations("workspaces");
  const tc = useTranslations("common");
  const pathname = usePathname();
  const path = bareWorkspacePath(pathname);
  const searchParams = useSearchParams();
  const here = useWorkspace();
  const loaded = useCurrentWorkspace();
  // Read here, where the rail always is, so the card opens with the list in it.
  const workspaces = useWorkspaces();
  // A workspace picked in the card is the rail's from the click on, as the mock switched: its tile
  // flies back to the rail as the card closes, and stays while its pages load. It's held for as long
  // as the navigation to it runs, and once the page is the picked one's, until it loads. However
  // that navigation ends (it arrives, another click replaces it, Back), the rail is the address's again.
  const slug = useWorkspaceSlug() ?? null;
  // What others shared with you lives in your own workspace: from an organization, its row in the card says how much there is.
  const own = slug === null ? undefined : workspaces.list?.find((workspace) => workspace.kind === "personal");
  const sharedWithYou = useProtectedQuery(api.sharing.shared.counts, own ? { workspaceId: own.workspaceId } : "skip").data?.total;
  const router = useRouter();
  const [picked, setPicked] = useState<WorkspaceRow | null>(null);
  const [switching, startSwitch] = useTransition();
  const loading = picked !== null && slug === (picked.slug ?? null) && loaded?.workspaceId !== picked.workspaceId;
  if (picked && !switching && !loading) setPicked(null);
  // Until the address's workspace is read, it's drawn as it looked last time; one never seen fades in once read.
  const auth = useAuth();
  const { userId } = auth;
  const cached = cachedRail(firstWorkspace, slug, auth, useHydrated());
  const current: WorkspaceLook | undefined = picked ?? loaded ?? cached.look;
  // The person as the account button shows them: as last time until Clerk and Convex load.
  const { user } = useUser();
  const { phase } = useAuthReadiness();
  const live: CachedMe | undefined = user ? { name: user.fullName || user.primaryEmailAddress?.emailAddress || "", ...(user.imageUrl ? { imageUrl: user.imageUrl } : {}) } : undefined;
  const me = live ?? cached.me;
  // Extract, which the workspace's flags turn on. Until they're read, it shows as it did last time. Communities shows in every workspace.
  const { planFeatures } = useSubscriptionState();
  const extractionOn = useFeatureFlagForPlan("extraction.enabled", planFeatures);
  const extractionStarts = useFeatureFlagForPlan("extraction.start", planFeatures);
  const liveExtracts = planFeatures === null ? undefined : extractionOn && extractionStarts;
  // Kept for the Authors page's "Create author", which its plan opens.
  const liveAuthors = useWorkspaceFeatures().data?.authors;
  // The rail's last answer, held while a switch reads the next workspace, so Extract doesn't leave and come back.
  const [held, setHeld] = useState(false);
  if (liveExtracts !== undefined && liveExtracts !== held) setHeld(liveExtracts);
  const extracts = liveExtracts ?? (cached.look ? cached.look.extract === true : held);
  // Publish, which Openscholar's admins switch on for everyone signed in. Until that is read, it shows as it did last time.
  const livePublishes = useQuery(api.reports.settings.open, {});
  const publishes = livePublishes ?? cached.look?.publish === true;
  const signedIn = phase === "authenticated" || (phase === "initializing" && !!(auth.isLoaded ? userId : firstWorkspace.user));
  // The browser's cookies are the outside system: the server draws the rail from them next time.
  useEffect(() => {
    if (!userId) return;
    const raw = lookCookieIn(document.cookie);
    const cache = readCache(raw, userId);
    const was = cache.looks[lookKey(slug)];
    const extract = liveExtracts ?? was?.extract === true;
    const author = liveAuthors ?? was?.author === true;
    const publish = livePublishes ?? was?.publish === true;
    const look: CachedLook | undefined = loaded && (loaded.slug ?? null) === slug ? { kind: loaded.kind, workspaceId: loaded.workspaceId, name: loaded.name, ...(loaded.imageUrl ? { imageUrl: loaded.imageUrl } : {}), ...(loaded.colour ? { colour: loaded.colour } : {}), ...(extract ? { extract: true as const } : {}), ...(publish ? { publish: true as const } : {}), ...(author ? { author: true as const } : {}) } : undefined;
    if (!look && !live) return;
    const next = writeCache(cache, userId, lookKey(slug), look, live);
    if (next && next !== raw) document.cookie = `${LOOK_COOKIE}=${next}; Path=/; Max-Age=${LOOK_KEPT_S}; SameSite=Lax`;
  }, [userId, slug, loaded, live?.name, live?.imageUrl, liveExtracts, liveAuthors, livePublishes]);
  const { currentQuery } = useCurrentQueryStore();
  const { keywords } = useKeywordExpansionStore();

  // Bookmarks' keyword shortcuts, as before: the count is the ones the current query can expand.
  const activeQuery = currentQuery || searchParams.get("q") || "";
  useQueryShortcuts(activeQuery);
  const expandable = [...activeQuery.matchAll(/(\w[\w-]*)\.\.\./g)].filter((m) => keywords[m[1]!]).length;
  const hasBookmarkSyntax = /(\w[\w-]*)\.\.\./g.test(activeQuery);

  const is = (p: string) => (p === "/" ? path === "/" || path.startsWith("/results") : path === p || path.startsWith(`${p}/`));
  const { data: screening } = useProtectedQuery(api.screening.queries.getActiveScreeningJobProgress, inWorkspace(here, {}));
  const { data: extraction } = useProtectedQuery(api.extraction.queries.jobs.runningJob, inWorkspace(here, {}));
  const tint = current ? workspaceTint(current) : undefined;
  const item = (props: Omit<React.ComponentProps<typeof RailItem>, "onClick">) => <RailItem {...props} onClick={onClose} />;
  const [card, setCard] = useState<"workspace" | "account" | null>(null);
  const { signOut } = useClerk();
  // Signing out waits for the account card to close: open, it would sit there as Clerk empties it. Once asked for,
  // the card doesn't open again, so nothing cancels its closing, and signing out starts once.
  const [signOutStep, setSignOutStep] = useState<"asked" | "started" | null>(null);
  // Clerk can finish signing out without reloading the page: the button then opens the signed-out card.
  if (signOutStep === "started" && !signedIn) setSignOutStep(null);
  const [creating, setCreating] = useState(false);
  const reduceMotion = useReducedMotion();
  const workspaceTrigger = useRef<HTMLButtonElement>(null);
  const accountTrigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    const back = card === "workspace" ? workspaceTrigger.current : accountTrigger.current;
    setCard(null);
    back?.focus();
  };

  return (
    <ShownWorkspace.Provider value={current}>
      <div className="relative h-full w-20">
        {/* While a card is up the rail steps back, the way iOS sets back the screen under a sheet. Its
            origin never changes, and the two buttons the cards grow from aren't in it, so whatever flies
            back to them lands on a spot that isn't moving. */}
        <motion.div
          // Its colour changes as a fade, never a cut.
          className="flex h-full w-20 flex-col items-center py-3 transition-[background-color] duration-500 ease-out motion-reduce:transition-none"
          initial={false}
          animate={card && !reduceMotion ? { scale: RECEDE, borderRadius: 22 } : { scale: 1, borderRadius: 0 }}
          transition={CARD_SPRING}
          style={{ backgroundColor: tint ? `color-mix(in oklab, ${tint} 7%, var(--sidebar))` : undefined, transformOrigin: "50% 50%" }}
        >
          <Link href="/" onClick={onClose} aria-label="Openscholar" className="mb-2 flex size-10 items-center justify-center rounded-xl transition-colors hover:bg-foreground/[0.06]">
            <LogoMark className="size-7" />
          </Link>
          {/* The workspace button's place. */}
          <div aria-hidden className="size-11 shrink-0" />
          <div className="my-2 h-px w-8 bg-foreground/10" />

          {/* A short window scrolls the sections, faded at an edge that has more, with a scrollbar only while it moves. */}
          <ScrollArea shades type="scroll" className="min-h-0 w-full flex-1">
            <nav aria-label={t("main")} className="flex w-full flex-col items-center gap-0.5 px-2">
              {item({ href: "/", icon: Search, label: tc("search"), active: is("/") })}
              {item({ href: "/library", icon: LibraryIcon, label: tc("library"), active: is("/library") })}
              {/* Publish (plans/publish-reports), drawn from the first frame when it showed last time; switched on since, it opens its place. */}
              <AnimatePresence initial={false}>
                {publishes && signedIn ? <Opening key="publish">{item({ href: "/publish", icon: PublishIcon, label: t("publish"), active: is("/publish") })}</Opening> : null}
              </AnimatePresence>
              {item({ href: "/history", icon: HistoryIcon, label: tc("history"), active: is("/history") })}
              {item({
                href: "/bookmarks",
                icon: BookmarksIcon,
                label: tc("bookmarks"),
                active: is("/bookmarks"),
                badge: expandable || undefined,
                tooltip: hasBookmarkSyntax ? <KeywordExpansionPreview query={activeQuery} /> : undefined,
              })}
              {item({
                href: "/screening",
                icon: ListChecks,
                label: t("screen"),
                active: is("/screening"),
                running: screening ? { done: screening.processedPapers + screening.failedPapers, total: screening.totalPapers, what: tc("screening"), percent: screening.percentComplete } : undefined,
              })}
              {/* Drawn from the first frame when the person's features are known from last time; ones read after open their place. */}
              <AnimatePresence initial={false}>
                {extracts ? (
                  <Opening key="extract">
                    {item({
                      href: "/extraction",
                      icon: ExtractionIcon,
                      label: t("extract"),
                      active: is("/extraction"),
                      running: extraction ? { done: extraction.done, total: extraction.total, what: extraction.name } : undefined,
                    })}
                  </Opening>
                ) : null}
                <Opening key="communities">{item({ href: "/evidence-communities", icon: EvidenceLibrariesIcon, label: t("communities"), active: is("/evidence-communities") })}</Opening>
                {/* What's shared with you is in your own workspace (#653), which the address says from the first frame. */}
                {slug === null ? <Opening key="shared">{item({ href: "/shared", icon: Share2, label: t("shared.nav"), active: is("/shared") })}</Opening> : null}
              </AnimatePresence>

              <div className="my-1.5 h-px w-8 bg-foreground/10" />
              {item({ href: "/topics", icon: ExploreIcon, label: t("explore"), active: is("/topics") || is("/authors") })}
            </nav>
          </ScrollArea>

          {/* Your photo's place. */}
          <div aria-hidden className="mt-2 size-11 shrink-0" />
        </motion.div>

        {/* Each button steps back with the rail, about the rail's centre, while the other card is up,
            and stays still while its own is, so what flies back to it lands on a spot that isn't moving. */}
        <motion.div
          className="absolute inset-x-0 top-[60px] flex justify-center"
          initial={false}
          animate={{ scale: card === "account" && !reduceMotion ? RECEDE : 1 }}
          transition={CARD_SPRING}
          style={{ transformOrigin: "50% calc(50vh - 60px)" }}
        >
          <WorkspaceButton ref={workspaceTrigger} workspace={current} open={card === "workspace"} onOpen={() => setCard("workspace")} />
        </motion.div>
        <motion.div
          className="absolute inset-x-0 bottom-3 flex justify-center"
          initial={false}
          animate={{ scale: card === "workspace" && !reduceMotion ? RECEDE : 1 }}
          transition={CARD_SPRING}
          style={{ transformOrigin: "50% calc(56px - 50vh)" }}
        >
          <AccountButton ref={accountTrigger} me={signedIn ? me : undefined} open={card === "account"} onOpen={() => signOutStep === null && setCard("account")} />
        </motion.div>
      </div>

      <RailCard
        open={card === "workspace" && !!current}
        from="top"
        label={t("workspacesCard")}
        onClose={close}
        head={
          current ? (
            <motion.span layoutId="rail-workspace-tile" layoutDependency={card === "workspace"} transition={CARD_SPRING} className="flex">
              <CardTile />
            </motion.span>
          ) : null
        }
      >
        <WorkspaceMenu
          shown={current}
          all={workspaces}
          shared={sharedWithYou}
          onDone={close}
          onSwitch={(slug, to) => {
            close();
            if (to) setPicked(to);
            startSwitch(() => router.push(switchTarget(slug, window.location.pathname, window.location.search.slice(1))));
          }}
          onCreate={() => {
            setCard(null);
            setCreating(true);
          }}
        />
      </RailCard>
      <RailCard
        open={card === "account"}
        from="bottom"
        label={t("account")}
        onClose={close}
        onClosed={
          signOutStep === "asked"
            ? () => {
                setSignOutStep("started");
                // On a phone the rail's sheet closes as signing out starts, not before the card has closed in it.
                onClose?.();
                // A sign-out that fails leaves the person signed in, says so, and gives their card back.
                signOut().catch(() => {
                  setSignOutStep(null);
                  showStyledToast("error", t("signOutFailed"));
                });
              }
            : undefined
        }
        head={
          <motion.span layoutId="rail-account-avatar" layoutDependency={card === "account"} transition={CARD_SPRING} className="flex rounded-full">
            <IdentityAvatar name={signedIn ? (me?.name ?? "") : ""} imageUrl={signedIn ? me?.imageUrl : undefined} className="size-10" />
          </motion.span>
        }
      >
        {signedIn ? (
          <AccountCard
            me={me}
            workspace={loaded}
            onNavigate={() => {
              setCard(null);
              onClose?.();
            }}
            onSignOut={() => {
              setSignOutStep("asked");
              setCard(null);
            }}
          />
        ) : (
          <GuestCard
            onNavigate={() => {
              setCard(null);
              onClose?.();
            }}
          />
        )}
      </RailCard>
      <CreateOrganization open={creating} onOpenChange={setCreating} />
    </ShownWorkspace.Provider>
  );
}

/** The workspace the rail shows, for the workspace card's head. */
const ShownWorkspace = React.createContext<WorkspaceLook | undefined>(undefined);

/**
 * The tile at the head of the workspace card. A closing card keeps what it last rendered, but this
 * reads the rail's workspace as it changes, so the tile that flies back from a card closed by a
 * pick is the picked workspace's, and the one the rail shows from then on.
 */
function CardTile() {
  const workspace = React.useContext(ShownWorkspace);
  return workspace ? (
    <Framed>
      <WorkspaceTile workspace={workspace} size="lg" home />
    </Framed>
  ) : null;
}

/**
 * A card that rises from the foot of the rail, or drops from its head, over the rail and the
 * page. The page dims behind it; a click outside or Escape sends it back.
 */
/** `onClosed` runs once the card has finished closing. */
function RailCard({ open, from, label, onClose, onClosed, head, children }: { open: boolean; from: "top" | "bottom"; label: string; onClose: () => void; onClosed?: () => void; head: React.ReactNode; children: React.ReactNode }) {
  const t = useTranslations("workspaces");
  const reduceMotion = useReducedMotion();
  const enter = from === "bottom" ? 36 : -36;
  // How far a card taller than the window is scrolled: the head, outside it, goes up and out with its row.
  const [scrolled, setScrolled] = useState(0);
  // Stable, so it focuses the card once, as it mounts, and not again as it renders.
  const focusOnOpen = useCallback((node: HTMLDivElement | null) => node?.focus({ preventScroll: true }), []);
  return (
    <AnimatePresence
      onExitComplete={() => {
        setScrolled(0);
        onClosed?.();
      }}
    >
      {open ? (
        <>
          <motion.button
            key="scrim"
            type="button"
            aria-label={t("close")}
            tabIndex={-1}
            onClick={onClose}
            className="fixed inset-0 z-[60] cursor-default bg-black/25 dark:bg-black/55"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
          />
          {/* The frame never moves: the tile or photo flying in lands on a fixed spot in it, while
              the card's surface slides and scales into place underneath. */}
          <div key="frame" className={cn("pointer-events-none fixed start-2 z-[61] w-[19rem]", from === "bottom" ? "bottom-2" : "top-2")}>
            <motion.div
              role="dialog"
              aria-label={label}
              tabIndex={-1}
              // A card takes focus as it opens, like a dialog, so Escape and Tab start in it. React's
              // autoFocus only focuses form controls.
              ref={focusOnOpen}
              onKeyDown={(e) => {
                // A key in a picker the card opened in a portal, such as the language list, is the picker's.
                if (!e.currentTarget.contains(e.target as Node)) return;
                if (e.key === "Escape") {
                  e.stopPropagation();
                  onClose();
                }
                // Tab stays in the card, as in a dialog: from its last control to its first, and back.
                if (e.key === "Tab") {
                  const controls = [...e.currentTarget.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])")];
                  const first = controls[0];
                  const last = controls.at(-1);
                  if (!first || !last) return;
                  const at = document.activeElement;
                  if (e.shiftKey ? at === first || at === e.currentTarget : at === last) {
                    e.preventDefault();
                    (e.shiftKey ? last : first).focus();
                  }
                }
              }}
              className={cn(
                "pointer-events-auto max-h-[calc(100dvh-1rem)] overflow-y-auto overscroll-contain rounded-[22px] border border-border/60 bg-popover p-1.5 text-popover-foreground outline-none dark:border-white/[0.06]",
                "shadow-[0_24px_64px_-16px_rgb(0_0_0/0.35),0_8px_24px_-12px_rgb(0_0_0/0.2)] dark:shadow-[0_24px_64px_-12px_rgb(0_0_0/0.8)]",
              )}
              style={{ transformOrigin: from === "bottom" ? "2.25rem 100%" : "2.25rem 0%" }}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: enter, scale: 0.88 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: enter * 0.6, scale: 0.92, transition: { duration: 0.24, ease: EASE } }}
              transition={CARD_SPRING}
              onScroll={(e) => setScrolled(e.currentTarget.scrollTop)}
            >
              {children}
            </motion.div>
            <div className="pointer-events-none absolute start-4 top-4" style={scrolled ? { transform: `translateY(${-scrolled}px)`, opacity: Math.max(0, 1 - scrolled / 24) } : undefined}>
              {head}
            </div>
          </div>
        </>
      ) : null}
    </AnimatePresence>
  );
}

/** The workspace's tile at the head of the rail. While its card is up, the tile is in the card. */
const WorkspaceButton = React.forwardRef<HTMLButtonElement, { workspace: WorkspaceLook | undefined; open: boolean; onOpen: () => void }>(function WorkspaceButton({ workspace, open, onOpen }, ref) {
  const reduceMotion = useReducedMotion();
  // Drawn from the page's first frame when the page came with the workspace's look; one it waited for fades in.
  return (
    <AnimatePresence initial={false}>
      {workspace ? (
        <motion.div key="workspace" initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={CARD_SPRING}>
          <WorkspaceButtonFace ref={ref} workspace={workspace} open={open} onOpen={onOpen} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
});

const WorkspaceButtonFace = React.forwardRef<HTMLButtonElement, { workspace: WorkspaceLook; open: boolean; onOpen: () => void }>(function WorkspaceButtonFace({ workspace, open, onOpen }, ref) {
  const t = useTranslations("workspaces");
  const { data: invitations } = useProtectedQuery(api.organizations.queries.myInvitations, inWorkspace(useWorkspace(), { paginationOpts: { cursor: null, numItems: 10 } }));
  const waiting = invitations?.page.length ?? 0;
  return (
    <Tooltip delayDuration={0} open={open ? false : undefined}>
      <TooltipTrigger asChild>
        <button ref={ref} type="button" aria-label={t("switchFrom", { name: workspace.name })} aria-expanded={open} onClick={onOpen} className="relative flex size-11 items-center justify-center rounded-xl transition-colors hover:bg-foreground/[0.06]">
          {open ? null : (
            <motion.span layoutId="rail-workspace-tile" layoutDependency={open} transition={CARD_SPRING} className="flex">
              <Framed>
                <WorkspaceTile workspace={workspace} size="md" home />
              </Framed>
            </motion.span>
          )}
          {waiting > 0 ? (
            <span className="absolute end-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground ring-2 ring-sidebar">{waiting}</span>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{workspace.name}</TooltipContent>
    </Tooltip>
  );
});

function RailItem({
  href,
  icon: Icon,
  label,
  active,
  onClick,
  running,
  badge,
  tooltip,
}: {
  href: string;
  icon: AppIcon;
  label: string;
  active: boolean;
  onClick?: () => void;
  /** A job running here: the ring fills, and the label becomes its progress, a percent when one is given. */
  running?: { done: number; total: number; what: string; percent?: number };
  badge?: number;
  tooltip?: React.ReactNode;
}) {
  const t = useTranslations("workspaces");
  const format = useFormatter();
  const share = running ? (running.percent !== undefined ? running.percent / 100 : running.total ? Math.min(1, running.done / running.total) : 0) : 0;
  const link = (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      aria-label={running ? t("runningLabel", { label, what: running.what, done: running.done, total: running.total }) : label}
      className="group flex w-full flex-col items-center gap-1 rounded-xl py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
    >
      <span className={cn("relative flex size-10 items-center justify-center rounded-xl transition-colors", active ? "text-foreground" : "text-muted-foreground group-hover:bg-foreground/[0.06] group-hover:text-foreground")}>
        {active ? <motion.span layoutId="rail-active" transition={SLIDE} className={cn("absolute inset-0 rounded-xl", RAISED)} /> : null}
        <Icon className="relative size-[18px]" />
        {running ? <ProgressRing value={share * 100} /> : null}
        {badge ? (
          <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground ring-2 ring-sidebar">{badge > 9 ? "9+" : badge}</span>
        ) : null}
      </span>
      <span className={cn("text-center text-[10px] font-medium leading-none tracking-tight tabular-nums transition-colors", running ? "text-primary" : active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")}>
        {running ? (running.percent !== undefined ? format.number(share, { style: "percent" }) : `${format.number(running.done)}/${format.number(running.total)}`) : label}
      </span>
    </Link>
  );
  if (!running && !tooltip) return link;
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      {tooltip ? (
        <TooltipContent side="right" className="w-80 max-w-xs border bg-background p-3 text-foreground shadow-lg" arrowClassName="bg-background fill-background">
          {tooltip}
        </TooltipContent>
      ) : (
        <TooltipContent side="right" className="flex items-center gap-2">
          <span className="font-medium">{running!.what}</span>
          <span className="tabular-nums opacity-70">{t("doneOf", { done: running!.done, total: running!.total })}</span>
        </TooltipContent>
      )}
    </Tooltip>
  );
}

/** You, at the foot of the rail. While the account card is up, your photo is in the card. */
/** The person's photo at the foot of the rail, or Sign in. `signedIn` and `me` hold from the first frame, as the server knew them, until Clerk loads. */
/** Your photo at the foot of the rail, or a person icon signed out. Either opens the account card. */
const AccountButton = React.forwardRef<HTMLButtonElement, { me: CachedMe | undefined; open: boolean; onOpen: () => void }>(function AccountButton({ me, open, onOpen }, ref) {
  const t = useTranslations("workspaces");
  const name = me?.name ?? "";
  return (
    <Tooltip delayDuration={0} open={open ? false : undefined}>
      <TooltipTrigger asChild>
        <button ref={ref} type="button" aria-label={t("account")} aria-expanded={open} onClick={onOpen} className="mt-2 flex size-11 items-center justify-center rounded-xl transition-colors hover:bg-foreground/[0.06]">
          {open ? null : (
            <motion.span layoutId="rail-account-avatar" layoutDependency={open} transition={CARD_SPRING} className="flex rounded-full">
              <IdentityAvatar name={name} imageUrl={me?.imageUrl} className="size-8" />
            </motion.span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{name || t("account")}</TooltipContent>
    </Tooltip>
  );
});

/**
 * The account card: you, the workspace's credits, settings, theme, language and sign out. It can be
 * opened while the page is still loading: it then has your name as the rail knows it (`me`), and
 * what is read after fades in or opens its place.
 */
function AccountCard({ me, workspace, onNavigate, onSignOut }: { me: CachedMe | undefined; workspace: WorkspaceRow | undefined; onNavigate: () => void; onSignOut: () => void }) {
  const t = useTranslations("workspaces");
  const tc = useTranslations("common");
  const format = useFormatter();
  const { user } = useUser();
  const { account, catalog, resolvedPlan, planFeatures } = useSubscriptionState();
  const plan = usePlanOf(workspace ?? { kind: "personal", name: "" });
  const subscriptions = useFeatureFlagForPlan("subscriptions.enabled", planFeatures);
  const seatBilling = useSeatBilling();
  // An organization's highest plan is Team while it's on sale; otherwise the plans anyone picks between, cheapest first.
  const highestPlan = workspace?.kind === "organization" && seatBilling ? TEAM_PLAN : catalog ? mainPlans(catalog).at(-1)?.id : undefined;
  const canUpgrade = subscriptions && resolvedPlan !== null && resolvedPlan !== highestPlan;
  const email = user?.primaryEmailAddress?.emailAddress;
  const billing = settingsHref(workspace, "/billing");
  const catalogPlan = catalog && resolvedPlan ? findPlan(catalog, resolvedPlan) : undefined;
  const monthly = catalogPlan?.credits?.interval === "month" ? catalogPlan.credits.included : undefined;
  const credits = account?.balance;
  const share = monthly && credits !== undefined ? Math.min(1, credits / monthly) : null;
  const hasCredits = !!workspace && credits !== undefined;
  // Credits that are in the card as it opens are simply there; ones read after open their place.
  const [creditsFromStart] = useState(hasCredits);
  return (
    <>
      <div className="flex items-center gap-3 px-2.5 pb-2.5 pt-2.5">
        <span aria-hidden className="size-10 shrink-0 rounded-full" />
        <span className="min-w-0 flex-1">
          {/* On a first visit the rail has no name until Clerk loads: the line is there, and the name fades in. */}
          <span className="block truncate text-[15px] font-semibold leading-tight tracking-tight">{me?.name ? <span className="animate-in fade-in-0 duration-200">{me.name}</span> : "\u00a0"}</span>
          {/* The line keeps its height while Clerk loads, and the address fades in. */}
          <span className="mt-0.5 block h-4 truncate text-xs text-muted-foreground">{email ? <span className="animate-in fade-in-0 duration-200">{email}</span> : null}</span>
        </span>
      </div>
      {/* Its own presence, so the card closing doesn't fold it: the photo flying back lands on the button only if the card keeps its height. */}
      <AnimatePresence>
        {hasCredits ? (
          <Opening key="credits" instant={creditsFromStart}>
            <div className="mx-1 mb-1 space-y-1">
              <Link href={billing} onClick={onNavigate} className="block space-y-2 rounded-2xl bg-foreground/[0.04] px-3 pb-3 pt-2.5 transition-colors hover:bg-foreground/[0.07]">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-xl font-semibold tabular-nums tracking-tight">{format.number(credits)}</span>
                  <span className="truncate text-xs text-muted-foreground">{t("planFor", { plan: plan.name, workspace: workspace.name })}</span>
                </span>
                {/* Against the month's credits, on a plan that grants them each month. */}
                {share !== null ? (
                  <span className="block h-1 overflow-hidden rounded-full bg-foreground/[0.08]">
                    <motion.span className="block h-full rounded-full bg-primary" initial={{ width: 0 }} animate={{ width: `${share * 100}%` }} transition={{ duration: 0.7, ease: EASE, delay: 0.15 }} />
                  </span>
                ) : null}
              </Link>
              {canUpgrade ? (
                <Button asChild size="sm" className="w-full">
                  <Link href="/pricing" onClick={onNavigate}>
                    <UpgradeIcon /> {tc("upgrade")}
                  </Link>
                </Button>
              ) : null}
            </div>
          </Opening>
        ) : null}
      </AnimatePresence>
      <div className="space-y-px pt-1">
        <MenuLink href="/settings" icon={SettingsIcon} onClick={onNavigate}>
          {tc("settings")}
        </MenuLink>
        <MenuLink href={billing} icon={BillingIcon} onClick={onNavigate}>
          {t("planAndCredits")}
        </MenuLink>
      </div>
      <Preferences />
      <div className="border-t border-border/60 pt-1">
        <button type="button" onClick={onSignOut} className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <LogOut className="size-4" /> {t("signOut")}
        </button>
      </div>
    </>
  );
}

/**
 * The account card signed out: Sign in where your name would be, then AI configuration and the
 * same preferences as signed in.
 */
function GuestCard({ onNavigate }: { onNavigate: () => void }) {
  const tc = useTranslations("common");
  const tai = useTranslations("aiSettings");
  const goToSignIn = useSignInRedirect();
  const creditsEnabled = useFeatureFlag("credits.enabled");
  return (
    <>
      <button
        type="button"
        onClick={() => {
          onNavigate();
          goToSignIn();
        }}
        className="flex w-full items-start gap-3 rounded-2xl px-2.5 py-2.5 text-start transition-colors hover:bg-muted"
      >
        {/* The photo flying in lands at the row's top, so the row lines up with it however its text wraps. */}
        <span aria-hidden className="size-10 shrink-0 rounded-full" />
        <span className="flex min-h-10 min-w-0 flex-1 flex-col justify-center">
          <span className="block text-[15px] font-semibold leading-tight tracking-tight">{tc("signIn")}</span>
          {creditsEnabled ? <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{tc("signInCreditsDescription")}</span> : null}
        </span>
        <LogIn className="mt-3 size-4 shrink-0 text-muted-foreground" />
      </button>
      <div className="space-y-px pt-1">
        <MenuLink href="/settings/ai" icon={AiIcon} onClick={onNavigate}>
          {tai("aiConfiguration")}
        </MenuLink>
      </div>
      <Preferences />
    </>
  );
}

/** Theme, language and query highlighting, the same signed in or out. */
function Preferences() {
  const t = useTranslations("workspaces");
  const tc = useTranslations("common");
  const { theme, setTheme } = useTheme();
  const highlight = useQueryHighlight();
  return (
    <div className="space-y-2 border-t border-border/60 px-1 pb-1 pt-2">
      <Segmented
        label={t("theme")}
        fill
        value={(theme ?? "system") as "light" | "dark" | "system"}
        onChange={setTheme}
        options={[
          { id: "light", label: t("light"), icon: Sun },
          { id: "dark", label: t("dark"), icon: Moon },
          { id: "system", label: t("auto"), icon: Monitor },
        ]}
      />
      <div className="flex items-center justify-between gap-2 ps-1.5">
        <span className="text-xs text-muted-foreground">{tc("language")}</span>
        <LanguageSwitcher isCollapsed={false} />
      </div>
      <label className="flex h-8 cursor-pointer items-center justify-between gap-2 ps-1.5 pe-2">
        <span className="text-xs text-muted-foreground">{tc("highlightSearchTerms")}</span>
        <Switch checked={highlight.on} onCheckedChange={highlight.setOn} />
      </label>
    </div>
  );
}

function MenuLink({ href, icon: Icon, onClick, children }: { href: string; icon: React.ElementType; onClick: () => void; children: React.ReactNode }) {
  return (
    <Link href={href} onClick={onClick} className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors hover:bg-muted">
      <Icon className="size-4 text-muted-foreground" />
      {children}
    </Link>
  );
}
