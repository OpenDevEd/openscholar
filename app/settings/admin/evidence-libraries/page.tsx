"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { Building2, Library, Search } from "@/components/icons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Input } from "@/components/ui/input";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { IdentityRow } from "@/components/ui/identity";
import { Switch } from "@/components/ui/switch";
import { TooltipHint } from "@/components/ui/tooltip";
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

/** Which organizations have Evidence Libraries, switched on one at a time; their plans stay as they are. */
export default function EvidenceLibraryAccessPage() {
  const workspaceId = useWorkspace();
  const t = useTranslations("settingsAdmin.evidenceLibraries");
  const tc = useTranslations("common");
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Show>("all");
  const search = useDebouncedValue(query.trim(), 300);
  const organizations = useCursorPage(api.organizations.libraryAccess.list, inWorkspace(workspaceId, { show, ...(search ? { search } : {}) }), PER_PAGE);
  const { data: count } = useProtectedQuery(api.organizations.libraryAccess.count, inWorkspace(workspaceId, { show }));
  // The last count stays up, dimmed with its rows, while another filter's is read.
  const [shownCount, setShownCount] = useState(count);
  if (count !== undefined && count !== shownCount) setShownCount(count);
  const set = useMutation(api.organizations.libraryAccess.set);
  const [busy, setBusy] = useState<Id<"organizations"> | null>(null);

  if (organizations.isLoading || shownCount === undefined) return <Enter ready={false}>{null}</Enter>;

  const toggle = async (organizationId: Id<"organizations">, on: boolean) => {
    setBusy(organizationId);
    try {
      await set({ organizationId, on });
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
          <div className="relative">
            <Search className="absolute start-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} aria-label={t("search")} className="h-11 rounded-2xl border border-border-subtle bg-inset ps-11" />
          </div>
          <Paged pager={{ list: organizations, size: PER_PAGE, total: search ? undefined : shownCount, counting: count === undefined }} rowHeight={ROW_HEIGHT} label={t("organizations")}>
            {/* A filter that leaves few doesn't pull up what's below. */}
            <div style={{ minHeight: PER_PAGE * ROW_HEIGHT + 1 }}>
            <ul className={LIST}>
              {organizations.items.map((organization) => {
                const held = organization.libraries > 0;
                const control = <Switch checked={organization.on} disabled={busy === organization._id || (held && organization.on)} aria-label={t("switchLabel", { name: organization.name })} onCheckedChange={(on) => void toggle(organization._id, on)} />;
                return (
                  <li key={organization._id}>
                    <IdentityRow
                      className="p-3"
                      avatar={
                        organization.imageUrl ? (
                          <IdentityAvatar name={organization.name} imageUrl={organization.imageUrl} className="size-9" />
                        ) : (
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                            <Building2 className="size-4" />
                          </span>
                        )
                      }
                      name={organization.name}
                    >
                      {held ? (
                        <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 text-xs tabular-nums text-muted-foreground">
                          <Library className="size-3.5" /> {t("libraries", { count: organization.libraries })}
                        </span>
                      ) : null}
                      {held && organization.on ? (
                        <TooltipHint label={t("moveFirst")}>
                          {/* A disabled switch takes no pointer, so its reason hangs on a wrapper that does. */}
                          <span tabIndex={0} className="inline-flex rounded-full">
                            {control}
                          </span>
                        </TooltipHint>
                      ) : (
                        control
                      )}
                    </IdentityRow>
                  </li>
                );
              })}
              {organizations.items.length === 0 ? <li className="py-10 text-center text-sm text-muted-foreground">{t("noMatches")}</li> : null}
            </ul>
            </div>
          </Paged>
        </div>
      </Zone>
    </Enter>
  );
}
