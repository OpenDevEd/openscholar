"use client";
import { useState } from "react";
import useSWR from "swr";
import { readAuthorCard } from "@/app/actions/author-card";
import { Plus, X } from "@/components/icons";
import { SkeletonBar } from "@/components/library/library-item-skeleton";
import { Button } from "@/components/ui/button";
import { TooltipHint } from "@/components/ui/tooltip";
import { linksOf, readLinks, writeLinks } from "@/lib/authors/mock-links";
import { unlessLimited } from "@/lib/openalex/limited";
import { useSearchSource } from "@/lib/search/use-search-source";
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
  const source = useSearchSource();
  const card = useSWR(["author-card", id, source], ([, author, reading]) => unlessLimited(readAuthorCard(author, reading)), { revalidateOnFocus: false });
  return (
    <RecordRow
      id={id}
      name={card.data?.name ?? <SkeletonBar className="h-4 w-40" />}
      detail={card.data ? `${card.data.works.toLocaleString()} papers` : <SkeletonBar className="h-3 w-24" />}
      action={
        <TooltipHint label="Remove">
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${id}`} onClick={onRemove}><X aria-hidden /></Button>
        </TooltipHint>
      }
    />
  );
}

/**
 * The records linked beside a profile's main one, and others with its name to add. An ID belongs to one profile at most.
 * ponytail: mock only, kept in a cookie; the real build saves them with the profile.
 */
export function LinkedRecords({ profileId, main, suggestions }: { profileId: string; main: string; suggestions: OpenAlexMatch[] }) {
  const [links, setLinks] = useState(readLinks);
  const save = (next: Record<string, string>) => {
    writeLinks(next);
    setLinks(next);
  };
  const extras = linksOf(links, profileId);
  const others = suggestions.filter(({ id }) => id !== main && !extras.includes(id)).slice(0, 5);
  return (
    <div className="mt-4 space-y-4">
      {!!extras.length && (
        <ul className="divide-y divide-border-subtle rounded-xl border border-border-subtle">
          {extras.map((id) => (
            <LinkedRecord key={id} id={id} onRemove={() => save(Object.fromEntries(Object.entries(links).filter(([linked]) => linked !== id)))} />
          ))}
        </ul>
      )}
      {!!others.length && (
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Other records with this name</p>
          <ul className="divide-y divide-border-subtle rounded-xl border border-border-subtle">
            {others.map((other) => {
              const taken = links[other.id] && links[other.id] !== profileId;
              return (
                <RecordRow
                  key={other.id}
                  id={other.id}
                  name={other.name}
                  detail={taken ? "Linked to another profile" : other.affiliation || other.topics}
                  action={
                    <Button type="button" variant="outline" size="sm" disabled={Boolean(taken)} onClick={() => save({ ...links, [other.id]: profileId })}>
                      <Plus aria-hidden />
                      Add
                    </Button>
                  }
                />
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
