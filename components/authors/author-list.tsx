"use client";
import { useTranslations } from "next-intl";
import { parseAsString, useQueryState } from "nuqs";
import { useRef, useState } from "react";
import { usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence } from "motion/react";
import { useWorkspace, useWorkspaceMutation } from "@/lib/workspaces/url";
import { useWorkspaceFeatures } from "@/lib/workspaces/use-workspace-features";
import { cn } from "@/lib/utils";
import { useWorkspaceRouter } from "@/lib/workspaces/href";
import Link from "@/components/workspace-link";
import { Plus, ArrowUpRight, Search, X } from "@/components/icons";
import { api } from "@/convex/_generated/api";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { useExploreHeader } from "@/components/topics/explore-header";
import { BAR_ACTION, BAR_LABEL } from "@/components/evidence-libraries/configuration/panel-header";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { AuthorAvatar } from "./author-avatar";
import { AuthorInvitations } from "./author-invitations";
import { IndexAuthors } from "./index-authors";
import { AUTHOR_PAGE_SIZE } from "./types";
import { Opening } from "@/components/workspaces/parts";
import { Field, FieldError } from "@/components/evidence-libraries/configuration/section-card";
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogFooter } from "@/components/ui/dialog";

/**
 * Every author profile, public. "Create author" shows where the workspace's plan makes profiles;
 * `createsBefore` is that as the rail last saw it, until the plan is read. `firstPage` is the list's first page, sent with the page.
 */
export function AuthorList({createsBefore, firstPage}: {createsBefore: boolean; firstPage: FunctionReturnType<typeof api.authors.profiles.list>}) {
  const tLabels = useTranslations("authorPages");
  const t = useTranslations("authorPages");
  const router = useWorkspaceRouter();
  // In the address, so Back from an author comes back to the search.
  const [search, setSearch] = useQueryState("q", parseAsString.withDefault("").withOptions({ history: "replace", shallow: true }));
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const create = useWorkspaceMutation(api.authors.profiles.create);
  const workspaceId = useWorkspace();
  const creates = useWorkspaceFeatures().data?.authors ?? createsBefore;
  // Hand-made profiles are only for a workspace whose plan makes them. Everyone else searches.
  const {results, status, loadMore} = usePaginatedQuery(api.authors.profiles.list, creates ? {search} : "skip", {initialNumItems: AUTHOR_PAGE_SIZE});
  const input = useRef<HTMLInputElement>(null);
  // The page arrives with its first profiles, so they show until the live list is in; a search waits for its own answer.
  const early = status === "LoadingFirstPage" && !search;
  const profiles = !creates ? [] : early ? firstPage.page : results;
  const more = creates && (early ? !firstPage.isDone : status === "CanLoadMore" || status === "LoadingMore");
  const explore = useExploreHeader("authors");
  // Read after the page drew, it opens its place beside the search: its own margin stands in for the row's gap, so the search moves only as it opens.
  return <LibraryPageShell {...explore} actions={<AnimatePresence initial={false}>{creates
    ? <Opening key="create" across className="-ms-2 overflow-clip [overflow-clip-margin:4px]"><Button size="sm" disabled={!workspaceId} className={cn("ms-2", BAR_ACTION)} onClick={() => {setError(""); setOpen(true);}}><Plus /><span className={BAR_LABEL}>{t("createAuthor")}</span></Button></Opening>
    : null}</AnimatePresence>}>
    <AuthorInvitations />
    <div className="px-4 pt-8 pb-6 sm:pt-10">
      <h2 className="text-2xl font-semibold tracking-tight">{t("findAuthors")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("authorSearchPitch")}</p>
      <div className="relative mt-5">
        <Search aria-hidden className="absolute start-4 top-1/2 size-4.5 -translate-y-1/2 text-muted-foreground" />
        <Input ref={input} aria-label={t("findAuthors")} placeholder={t("authorSearchPlaceholder")} className="h-12 border-transparent bg-inset ps-11 pe-11 text-base shadow-none md:text-base" value={search} onChange={event => void setSearch(event.target.value || null)} />
        {search && <Button type="button" variant="ghost" size="icon-sm" aria-label={t("clearAuthorSearch")} className="absolute end-2 top-1/2 -translate-y-1/2" onClick={() => {void setSearch(null); input.current?.focus();}}><X /></Button>}
      </div>
    </div>
    {!!profiles.length && <p className="border-t border-border-subtle px-4 pt-4 pb-1 text-xs font-medium text-muted-foreground">{t("authorProfilesLabel")}</p>}
    {!!profiles.length && <ul className="divide-y divide-border-subtle">{profiles.map(profile => <li key={profile._id} className="fade-enter"><Link href={`/authors/${profile._id}`} className="group flex items-center gap-3 p-4 hover:bg-muted">
      <AuthorAvatar photo={profile.photo} className="me-1 size-10 shrink-0" />
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium group-hover:underline">{profile.name}</p><p className="truncate text-xs text-muted-foreground">{profile.headline || profile.affiliation}</p></div>
      <ArrowUpRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
    </Link></li>)}</ul>}
    {more && <div className="flex justify-center border-t border-border-subtle p-3"><Button variant="ghost" size="sm" disabled={early || status === "LoadingMore"} onClick={() => loadMore(AUTHOR_PAGE_SIZE)}>{status === "LoadingMore" && <Spinner />}{t("showMore")}</Button></div>}
    <IndexAuthors search={search} examples={!profiles.length} profiled={new Set(profiles.map(profile => profile.openalex).filter(Boolean))} />
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{t("createAuthorProfile")}</DialogTitle></DialogHeader><form className="space-y-4" onSubmit={async event => {
      event.preventDefault(); if (creating) return; setCreating(true); setError("");
      try { const id = await create({name}); router.push(`/authors/${id}/configuration`); setOpen(false); }
      catch (error) { setError(error instanceof Error ? error.message : tLabels("couldNotCreateProfile")); }
      finally { setCreating(false); }
    }}><Field label={t("name")}>{id => <Input id={id} value={name} onChange={event => setName(event.target.value)} required maxLength={500} autoFocus />}</Field>{error && <FieldError>{error}</FieldError>}<DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>{t("cancel")}</Button><Button type="submit" disabled={creating || !name.trim()}><Plus />{t("createProfile")}</Button></DialogFooter></form></DialogContent></Dialog>
  </LibraryPageShell>;
}
