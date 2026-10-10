"use client";

// Shared with me (#653): the items people outside your workspaces gave you, and the page an
// invitation's email links to. They sit in your own workspace, and work you run on them uses
// your own credits.

import { useDeferredValue, useState } from "react";
import { useRouter } from "next/navigation";
import { usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { Building2, Coins, Folder, LogOut, SearchX, Share2, Unlink, UserRound, type AppIcon } from "@/components/icons";
import { CommandCenterFilters } from "@/components/command-center/command-center-toolbar";
import { Entry, EntryAction, EntryAside, ENTRY_OPEN } from "@/components/command-center/entry";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { ListEmpty, ListLoading } from "@/components/evidence-libraries/list-controls";
import { LIST, Tile } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { PersonTag, RoleLabel } from "@/components/ui/identity";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { showStyledToast } from "@/components/ui/sonner";
import Link from "@/components/workspace-link";
import { api } from "@/convex/_generated/api";
import type { GuestRole, SharedKind } from "@/convex/sharing/validators";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { SHARED_PAGE } from "@/lib/sharing";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";
import { inWorkspace, useWorkspace, useWorkspaceAction, useWorkspaceMutation } from "@/lib/workspaces/url";
import { Chip, Hero, Landing, Point } from "./join";
import { useCurrentWorkspace, WorkspaceTag, WorkspaceTile } from "./parts";

/** Each kind's look, where one opens in your own workspace, and the roles its guests can be given (convex/sharing/items.ts). */
export const SHARED_KINDS: Record<SharedKind, { icon: AppIcon; tint: string; href: (id: string) => string; roles: readonly GuestRole[] }> = {
  collection: { icon: Folder, tint: "#e8890c", href: (id) => `/library?col=${id}`, roles: ["viewer"] },
};

type Sort = "recent" | "name";
type Counts = FunctionReturnType<typeof api.sharing.shared.counts>;

/** `initial` is what the page's route read on the server: the counts, and the first page newest first. */
export function SharedWithMe({ initial }: { initial?: { counts: Counts; rows: SharedItem[] } }) {
  const t = useTranslations("workspaces.shared");
  const workspaceId = useWorkspace();
  const workspace = useCurrentWorkspace();
  const [kind, setKind] = useState<SharedKind | null>(null);
  const [text, setText] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const needle = useDeferredValue(text.trim());
  const counts = useProtectedQuery(api.sharing.shared.counts, inWorkspace(workspaceId, {})).data ?? initial?.counts;
  const { results, status, loadMore } = usePaginatedQuery(api.sharing.shared.list, inWorkspace(workspaceId, { sort, ...(kind ? { kind } : {}), ...(needle ? { text: needle } : {}) }), { initialNumItems: SHARED_PAGE });
  // The rows shown: the view asked for once it's read, and until then the ones shown last, which at first are the page's own.
  const loading = status === "LoadingFirstPage";
  const [kept, keep] = useState(initial?.rows);
  if (!loading && kept !== results) keep(results);
  const rows = loading ? kept : results;
  const kinds = (Object.keys(SHARED_KINDS) as SharedKind[]).filter((one) => counts?.[one]);

  return (
    <LibraryPageShell
      icon={Share2}
      title={t("title")}
      filters={
        <CommandCenterFilters
          sortOptions={[
            { value: "recent", label: t("sortRecent") },
            { value: "name", label: t("sortName") },
          ]}
          currentSort={sort}
          onSortChange={setSort}
          searchFilter={text}
          onSearchChange={setText}
          placeholder={t("search")}
        />
      }
      intro={
        <div className="space-y-3 px-4 py-3">
          <div className="flex h-8 gap-1.5 overflow-x-auto mask-r-from-[calc(100%-2rem)] pr-8 [scrollbar-width:none]">
            {counts ? (
              <>
                <KindChip on={kind === null} onClick={() => setKind(null)} count={counts.total}>
                  {t("all")}
                </KindChip>
                {kinds.map((one) => {
                  const Icon = SHARED_KINDS[one].icon;
                  return (
                    <KindChip key={one} on={kind === one} onClick={() => setKind(kind === one ? null : one)} count={counts[one]}>
                      <Icon className="size-3.5" style={{ color: SHARED_KINDS[one].tint }} />
                      {t(`kinds.${one}`)}
                    </KindChip>
                  );
                })}
              </>
            ) : null}
          </div>
          <p className="flex h-6 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {t("runUses")}
            {workspace ? (
              <WorkspaceTag workspace={workspace} size="sm" strong>
                {t("yourCredits")}
              </WorkspaceTag>
            ) : null}
          </p>
        </div>
      }
    >
      {rows?.length ? (
        // Rows of the view before stay, dimmed and still, until the one asked for arrives.
        <div className={cn("divide-y divide-border-subtle", loading && "pointer-events-none opacity-60")}>
          {rows.map((item) => (
            <Row key={item.id} item={item} />
          ))}
        </div>
      ) : !rows ? (
        <ListLoading label={t("loading")} />
      ) : (
        <ListEmpty icon={needle ? SearchX : Share2}>{needle ? t("emptySearch") : kind ? t("emptyKind") : t("empty")}</ListEmpty>
      )}
      {status === "CanLoadMore" || status === "LoadingMore" ? (
        <div className="flex justify-center border-t border-border-subtle p-3">
          <Button variant="ghost" size="sm" disabled={status === "LoadingMore"} onClick={() => loadMore(SHARED_PAGE)}>
            {t("more")}
          </Button>
        </div>
      ) : null}
    </LibraryPageShell>
  );
}

function KindChip({ on, onClick, count, children }: { on: boolean; onClick: () => void; count: number; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors",
        on ? "border-primary/40 bg-primary/10 text-primary" : "border-border-subtle text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

type SharedItem = { kind: SharedKind; id: string; name: string; role: "viewer" | "editor"; at: number; by: { name: string; imageUrl?: string }; from: From; size: number };

type From = { name: string; organization: boolean };

/**
 * What a guest is told of an item wherever they see it: the organization it's in, and what they
 * may do with it. One in a person's own workspace names them with `person`, where nothing beside
 * it says who shared it.
 */
export function GuestChips({ from, role, person = false }: { from: From; role: "viewer" | "editor"; person?: boolean }) {
  const t = useTranslations("workspaces.share");
  const Icon = from.organization ? Building2 : UserRound;
  return (
    <>
      {from.organization || person ? (
        <span className="inline-flex h-6 min-w-0 max-w-full items-center gap-1.5 rounded-full bg-muted px-2.5 text-xs text-muted-foreground">
          <Icon className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">{from.name}</span>
        </span>
      ) : null}
      <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-primary/10 px-2.5">
        <RoleLabel role={role === "viewer" ? "view" : "edit"} className="text-primary">
          {role === "viewer" ? t("canView") : t("canEdit")}
        </RoleLabel>
      </span>
    </>
  );
}

function Row({ item }: { item: SharedItem }) {
  const t = useTranslations("workspaces.shared");
  const format = useFormatter();
  const now = useNow();
  const leave = useWorkspaceMutation(api.sharing.guests.leave);
  const kind = SHARED_KINDS[item.kind];
  return (
    <Entry viewMode="list-detail">
      <Tile icon={kind.icon} tint={kind.tint} className="size-10 rounded-xl" />
      <div className="min-w-0 flex-1 space-y-2">
        <Link href={kind.href(item.id)} className={cn(ENTRY_OPEN, "line-clamp-2")}>
          {item.name}
        </Link>
        <div className="flex flex-wrap items-center gap-1.5">
          <PersonTag name={item.by.name} imageUrl={item.by.imageUrl} />
          <GuestChips from={item.from} role={item.role} />
          <span className="inline-flex h-6 items-center rounded-full border border-border-subtle px-2.5 text-xs tabular-nums text-muted-foreground">{t(`size.${item.kind}`, { count: item.size })}</span>
        </div>
      </div>
      <EntryAside className="h-7 self-start" meta={<time>{format.relativeTime(item.at, now)}</time>}>
        <EntryAction label={t("leave")} icon={LogOut} danger onClick={() => void leave({ id: item.id }).catch((error) => showStyledToast("error", getErrorMessage(error, t("leaveFailed"))))} />
      </EntryAside>
    </Entry>
  );
}

/** Where an invitation's email links: who shared what, and opening it, which takes the invitation up. */
export function OpenShared({ invitationId }: { invitationId: string }) {
  const t = useTranslations("workspaces.shared");
  const tw = useTranslations("workspaces");
  const ts = useTranslations("workspaces.share");
  const router = useRouter();
  const workspaceId = useWorkspace();
  const personal = useCurrentWorkspace();
  const { data: invitation } = useProtectedQuery(api.sharing.invitations.get, inWorkspace(workspaceId, { invitationId }));
  const respond = useWorkspaceAction(api.sharing.invitations.respond);
  const [opening, setOpening] = useState(false);
  if (invitation === undefined) return <Landing />;
  if (invitation === null) {
    return (
      <Landing hero={<Hero icon={Unlink} />} title={t("goneTitle")} chips={<p className="text-sm text-muted-foreground">{t("goneDetail")}</p>}>
        <Button variant="outline" className="w-full" asChild>
          <Link href="/">{tw("goToSearch")}</Link>
        </Button>
      </Landing>
    );
  }
  const kind = SHARED_KINDS[invitation.kind];
  const open = () => {
    setOpening(true);
    // One taken up already opens as it is.
    void (invitation.state === "pending" ? respond({ invitationId: invitationId as never, accept: true }) : Promise.resolve(null)).then(
      () => router.push(kind.href(invitation.id)),
      (error) => {
        setOpening(false);
        showStyledToast("error", getErrorMessage(error, t("openFailed")));
      },
    );
  };
  return (
    <Landing
      hero={<Tile icon={kind.icon} tint={kind.tint} className="size-24 rounded-3xl [&>svg]:size-10" />}
      lead={<Chip lead={<IdentityAvatar name={invitation.by.name} imageUrl={invitation.by.imageUrl} className="size-5" />}>{t(`sharedOne.${invitation.kind}`, { name: invitation.by.name })}</Chip>}
      title={invitation.name}
      chips={
        <>
          {invitation.from.organization ? (
            <Chip>
              <Building2 className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">{invitation.from.name}</span>
            </Chip>
          ) : null}
          <Chip tone="primary">
            <RoleLabel role={invitation.role === "viewer" ? "view" : "edit"} className="text-primary">
              {invitation.role === "viewer" ? ts("canView") : ts("canEdit")}
            </RoleLabel>
          </Chip>
          <Chip>
            <span className="tabular-nums">{t(`size.${invitation.kind}`, { count: invitation.size })}</span>
          </Chip>
        </>
      }
    >
      <ul className={LIST}>
        <Point lead={personal ? <WorkspaceTile workspace={personal} /> : <span className="size-8" />}>{t("pointOwn")}</Point>
        <Point lead={<Tile icon={Coins} tint="#facc15" className="size-8" />}>{t("pointCredits")}</Point>
      </ul>
      <Button className="w-full" disabled={opening} onClick={open}>
        {t("open")}
      </Button>
    </Landing>
  );
}
