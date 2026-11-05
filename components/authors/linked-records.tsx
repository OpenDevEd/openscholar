"use client";
import { useQuery } from "convex/react";
import { useFormatter, useTranslations } from "next-intl";
import useSWR from "swr";
import { readAuthorCard } from "@/app/actions/author-card";
import { Plus, X } from "@/components/icons";
import { SkeletonBar } from "@/components/library/library-item-skeleton";
import { Button } from "@/components/ui/button";
import { TooltipHint } from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { readConvexErrorData } from "@/convex/lib/errors";
import { useAppToast } from "@/lib/toast";
import { useWorkspaceMutation } from "@/lib/workspaces/url";
import { unlessLimited } from "@/lib/openalex/limited";
import { useSearchSource } from "@/lib/search/use-search-source";
import Link from "@/components/workspace-link";
import { AuthorAvatar } from "./author-avatar";
import type { OpenAlexMatch } from "./types";

function RecordRow({ name, detail, id, action }: { name: React.ReactNode; detail: React.ReactNode; id: string; action: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <AuthorAvatar className="size-8 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className="flex h-4 items-center truncate text-xs text-muted-foreground">{detail}</div>
      </div>
      <code className="hidden shrink-0 rounded bg-inset px-1.5 py-0.5 text-3xs text-muted-foreground sm:block">{id}</code>
      {action}
    </li>
  );
}

/** A record linked beside the main one, named once its record is read. */
function LinkedRecord({ id, onRemove }: { id: string; onRemove: () => void }) {
  const t = useTranslations("authorPages");
  const format = useFormatter();
  const source = useSearchSource();
  const card = useSWR(["author-card", id, source], ([, author, reading]) => unlessLimited(readAuthorCard(author, reading)), { revalidateOnFocus: false });
  return (
    <RecordRow
      id={id}
      name={card.data && "name" in card.data ? card.data.name : <SkeletonBar className="h-4 w-40" />}
      detail={card.data && "works" in card.data ? t("recordPapers", { count: card.data.works, shown: format.number(card.data.works) }) : <SkeletonBar className="h-3 w-24" />}
      action={
        <TooltipHint label={t("removeRecord")}>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t("removeRecord")} onClick={onRemove}><X aria-hidden /></Button>
        </TooltipHint>
      }
    />
  );
}

/** The records a profile links beside its main one, and others with its name to add. A record belongs to one profile at most. */
export function LinkedRecords({ profileId, main, name, suggestions }: { profileId: Id<"authorProfiles">; main: string[]; name: string; suggestions: OpenAlexMatch[] }) {
  const t = useTranslations("authorPages");
  const toast = useAppToast();
  const linked = useQuery(api.authors.links.records, { profileId });
  const add = useWorkspaceMutation(api.authors.links.add);
  const remove = useWorkspaceMutation(api.authors.links.remove);
  const failed = (error: unknown) => toast.error(readConvexErrorData(error)?.message ?? t("couldNotSaveThisProfile"));
  const extras = (linked ?? []).filter((id) => !main.includes(id));
  // The search matches any word, so only records sharing the surname are offered as this person.
  const surname = name.trim().split(/\s+/).at(-1)?.toLowerCase();
  const others = linked ? suggestions.filter((other) => !main.includes(other.id) && !linked.includes(other.id) && other.name.trim().split(/\s+/).at(-1)?.toLowerCase() === surname).slice(0, 5) : [];
  return (
    <div className="mt-4 space-y-4">
      {!!extras.length && (
        <ul className="divide-y divide-border-subtle rounded-xl border border-border-subtle">
          {extras.map((id) => <LinkedRecord key={id} id={id} onRemove={() => void remove({ profileId, authorId: id }).catch(failed)} />)}
        </ul>
      )}
      {!!others.length && (
        <div className="fade-enter">
          <p className="mb-2 text-xs font-medium text-muted-foreground">{t("otherRecordsWithThisName")}</p>
          <ul className="divide-y divide-border-subtle rounded-xl border border-border-subtle">
            {others.map((other) => (
              <RecordRow
                key={other.id}
                id={other.id}
                // Its own page, in a new tab, to check it's the same person.
                name={<Link href={`/authors/${other.id}`} target="_blank" rel="noreferrer" className="hover:underline">{other.name}</Link>}
                detail={[other.affiliation, other.topics].filter(Boolean).join("  ")}
                action={
                  <Button type="button" variant="outline" size="sm" onClick={() => void add({ profileId, authorId: other.id }).catch(failed)}>
                    <Plus aria-hidden />
                    {t("addRecord")}
                  </Button>
                }
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
