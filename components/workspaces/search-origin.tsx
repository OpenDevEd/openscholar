"use client";

// Beside a search's tabs, when the search isn't simply yours (#653, #656): who ran it, and for one
// shared with you where it's from and what you may do with it; or, for the copy a link to a
// search you can't open made you, that it's yours to change.

import { useTranslations } from "next-intl";
import { Link2 } from "@/components/icons";
import { PersonTag } from "@/components/ui/identity";
import { TooltipHint } from "@/components/ui/tooltip";
import { useSearchAccess } from "@/lib/research/reads";
import { useCopiedSearches } from "@/lib/search/copied";
import { GuestChips } from "./shared";

export function SearchOrigin({ searchId }: { searchId: string }) {
  const t = useTranslations("searchCommand");
  const ta = useTranslations("workspaces.activity");
  const access = useSearchAccess(searchId);
  const copied = useCopiedSearches((state) => state.ids.includes(searchId));
  const by = access?.by && (access.guest || !access.by.you) ? <PersonTag {...access.by} before={ta("runBy")} /> : null;
  if (access?.guest) {
    return (
      <>
        {by}
        {/* A person's own workspace is named by who ran it; an organization's has its own chip. */}
        <GuestChips from={access.guest.from} role={access.guest.role} />
      </>
    );
  }
  if (by) return by;
  if (!copied) return null;
  return (
    <TooltipHint label={t("yourCopyHint")}>
      <span className="inline-flex h-6 min-w-0 max-w-full items-center gap-1.5 rounded-full bg-muted px-2.5 text-xs text-muted-foreground">
        <Link2 className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{t("yourCopy")}</span>
      </span>
    </TooltipHint>
  );
}
