"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { Building2, Library, Search, UserRound } from "@/components/icons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Input } from "@/components/ui/input";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { IdentityRow } from "@/components/ui/identity";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { Enter, LIST, Paged, Segmented, Zone } from "@/components/settings/parts";
import { inWorkspace, useWorkspace } from "@/lib/workspaces/url";

const PER_PAGE = 8;
const ROW_HEIGHT = 61;

type Show = "all" | "on" | "off";
type Kind = "organizations" | "people";
type Row = { _id: string; name: string; detail?: string; imageUrl?: string; on: boolean; libraries: number; kind: "person" | "organization" };

/**
 * Which workspaces can create Evidence Communities, switched on one at a time: an organization's,
 * for its admins, or a person's own. Their plans stay as they are, and off only stops new ones.
 */
export default function EvidenceLibraryAccessPage() {
  const workspaceId = useWorkspace();
  const t = useTranslations("settingsAdmin.evidenceLibraries");
  const tc = useTranslations("common");
  const [kind, setKind] = useState<Kind>("organizations");
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Show>("all");
  const search = useDebouncedValue(query.trim(), 300);
  const args = inWorkspace(workspaceId, { show, ...(search ? { search } : {}) });
  const organizations = useCursorPage(api.organizations.libraryAccess.list, kind === "organizations" ? args : "skip", PER_PAGE);
  const people = useCursorPage(api.organizations.libraryAccess.listPeople, kind === "people" ? args : "skip", PER_PAGE);
  const { data: count } = useProtectedQuery(kind === "organizations" ? api.organizations.libraryAccess.count : api.organizations.libraryAccess.countPeople, inWorkspace(workspaceId, { show }));
  // The last count stays up, dimmed with its rows, while another filter's is read.
  const [shownCount, setShownCount] = useState(count);
  if (count !== undefined && count !== shownCount) setShownCount(count);
  const set = useMutation(api.organizations.libraryAccess.set);
  const setPerson = useMutation(api.organizations.libraryAccess.setPerson);
  const [busy, setBusy] = useState<string | null>(null);
  const list = kind === "organizations" ? organizations : people;

  if (list.isLoading || shownCount === undefined) return <Enter ready={false}>{null}</Enter>;

  const rows: Row[] = kind === "organizations"
    ? organizations.items.map((row) => ({ _id: row._id, name: row.name, imageUrl: row.imageUrl, on: row.on, libraries: row.libraries, kind: "organization" }))
    : people.items.map((row) => ({ _id: row._id, name: row.name ?? row.email, ...(row.name ? { detail: row.email } : {}), imageUrl: row.imageUrl, on: row.on, libraries: row.libraries, kind: "person" }));
  const toggle = async (row: Row, on: boolean) => {
    setBusy(row._id);
    try {
      if (row.kind === "organization") await set({ organizationId: row._id as Id<"organizations">, on });
      else await setPerson({ userId: row._id as Id<"users">, on });
    } catch (error) {
      toast.error(getErrorMessage(error, tc("somethingWentWrong")));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Enter ready>
      <Zone
        label={t("title")}
        aside={
          <Segmented
            label={t("show")}
            value={show}
            onChange={setShow}
            options={[
              { id: "all" as const, label: t("all") },
              { id: "on" as const, label: t("on") },
              { id: "off" as const, label: t("off") },
            ]}
          />
        }
      >
        <div className="space-y-3">
          <Segmented
            label={t("kind")}
            value={kind}
            onChange={(next) => { setKind(next); setQuery(""); }}
            fill
            options={[
              { id: "organizations" as const, label: t("organizationsTab"), icon: Building2 },
              { id: "people" as const, label: t("peopleTab"), icon: UserRound },
            ]}
          />
          <div className="relative">
            <Search className="absolute start-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={kind === "organizations" ? t("search") : t("searchPeople")} aria-label={kind === "organizations" ? t("search") : t("searchPeople")} className="h-11 rounded-2xl border border-border-subtle bg-inset ps-11" />
          </div>
          <Paged pager={{ list, size: PER_PAGE, total: search ? undefined : shownCount, counting: count === undefined }} rowHeight={ROW_HEIGHT} label={kind === "organizations" ? t("organizations") : t("people")}>
            {/* A filter that leaves few doesn't pull up what's below. */}
            <div style={{ minHeight: PER_PAGE * ROW_HEIGHT + 1 }}>
            <ul className={LIST}>
              {rows.map((row) => (
                <li key={row._id}>
                  <IdentityRow
                    className="p-3"
                    avatar={
                      row.imageUrl ? (
                        <IdentityAvatar name={row.name} imageUrl={row.imageUrl} kind={row.kind} className="size-9" />
                      ) : (
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          {row.kind === "organization" ? <Building2 className="size-4" /> : <UserRound className="size-4" />}
                        </span>
                      )
                    }
                    name={row.name}
                    detail={row.detail}
                  >
                    {row.libraries > 0 ? (
                      <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 text-xs tabular-nums text-muted-foreground">
                        <Library className="size-3.5" /> {t("libraries", { count: row.libraries })}
                      </span>
                    ) : null}
                    <Switch checked={row.on} disabled={busy === row._id} aria-label={t("switchLabel", { name: row.name })} onCheckedChange={(on) => void toggle(row, on)} />
                  </IdentityRow>
                </li>
              ))}
              {rows.length === 0 ? <li className="py-10 text-center text-sm text-muted-foreground">{kind === "organizations" ? t("noMatches") : t("noPeopleMatch")}</li> : null}
            </ul>
            </div>
          </Paged>
        </div>
      </Zone>
    </Enter>
  );
}
