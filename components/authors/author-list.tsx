"use client";
import { useState } from "react";
import { usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence } from "motion/react";
import { useWorkspaceMutation } from "@/lib/workspaces/url";
import { useWorkspaceFeatures } from "@/lib/workspaces/use-workspace-features";
import { cn } from "@/lib/utils";
import { useWorkspaceRouter } from "@/lib/workspaces/href";
import Link from "@/components/workspace-link";
import { Users, Plus, ArrowUpRight, SearchX } from "@/components/icons";
import { api } from "@/convex/_generated/api";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { useExploreHeader } from "@/components/topics/explore-header";
import { BAR_ACTION, BAR_LABEL } from "@/components/evidence-libraries/configuration/panel-header";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { ListEmpty, ListLoading, ListSearch } from "@/components/evidence-libraries/list-controls";
import { AuthorAvatar } from "./author-avatar";
import { AuthorInvitations } from "./author-invitations";
import { AUTHOR_PAGE_SIZE } from "./types";
import { Opening } from "@/components/workspaces/parts";
import { Field, FieldError } from "@/components/evidence-libraries/configuration/section-card";
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogFooter } from "@/components/ui/dialog";

/**
 * Every author profile, public. "Create author" shows where the workspace's plan makes profiles;
 * `createsBefore` is that as the rail last saw it, until the plan is read. `firstPage` is the list's first page, sent with the page.
 */
export function AuthorList({createsBefore, firstPage}: {createsBefore: boolean; firstPage: FunctionReturnType<typeof api.authors.profiles.list>}) {
  const router = useWorkspaceRouter();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const create = useWorkspaceMutation(api.authors.profiles.create);
  const {results, status, loadMore} = usePaginatedQuery(api.authors.profiles.list, {search}, {initialNumItems: AUTHOR_PAGE_SIZE});
  // The page arrives with its first profiles, so they show until the live list is in; a search waits for its own answer.
  const early = status === "LoadingFirstPage" && !search;
  const profiles = early ? firstPage.page : results;
  const more = early ? !firstPage.isDone : status === "CanLoadMore" || status === "LoadingMore";
  const creates = useWorkspaceFeatures().data?.authors ?? createsBefore;
  const explore = useExploreHeader("authors");
  // Read after the page drew, it opens its place beside the search: its own margin stands in for the row's gap, so the search moves only as it opens.
  return <LibraryPageShell {...explore} actions={<AnimatePresence initial={false}>{creates
    ? <Opening key="create" across className="-ml-2 overflow-clip [overflow-clip-margin:4px]"><Button size="sm" className={cn("ml-2", BAR_ACTION)} onClick={() => {setError(""); setOpen(true);}}><Plus /><span className={BAR_LABEL}>Create author</span></Button></Opening>
    : null}</AnimatePresence>}
    filters={<ListSearch aria-label="Find authors" placeholder="Find an author…" className="w-56" value={search} onChange={event => setSearch(event.target.value)} />}>
    <AuthorInvitations />
    {!!profiles.length && <ul className="divide-y divide-border-subtle">{profiles.map(profile => <li key={profile._id} className="fade-enter"><Link href={`/authors/${profile._id}`} className="group flex items-center gap-3 p-4 hover:bg-muted">
      <AuthorAvatar photo={profile.photo} className="mr-1 size-10 shrink-0" />
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium group-hover:underline">{profile.name}</p><p className="truncate text-xs text-muted-foreground">{profile.headline || profile.affiliation}</p></div>
      <ArrowUpRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
    </Link></li>)}</ul>}
    {!profiles.length && (status === "LoadingFirstPage" && !early
      ? <ListLoading label="Loading authors" />
      : <ListEmpty icon={search ? SearchX : Users}>{search ? "No authors match your search." : "No authors yet."}</ListEmpty>)}
    {more && <div className="flex justify-center border-t border-border-subtle p-3"><Button variant="ghost" size="sm" disabled={early || status === "LoadingMore"} onClick={() => loadMore(AUTHOR_PAGE_SIZE)}>{status === "LoadingMore" && <Spinner />}Show more</Button></div>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Create author profile</DialogTitle></DialogHeader><form className="space-y-4" onSubmit={async event => {
      event.preventDefault(); if (creating) return; setCreating(true); setError("");
      try { const id = await create({name}); router.push(`/authors/${id}/configuration`); setOpen(false); }
      catch (error) { setError(error instanceof Error ? error.message : "Could not create profile"); }
      finally { setCreating(false); }
    }}><Field label="Name">{id => <Input id={id} value={name} onChange={event => setName(event.target.value)} required maxLength={500} autoFocus />}</Field>{error && <FieldError>{error}</FieldError>}<DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={creating || !name.trim()}><Plus />Create profile</Button></DialogFooter></form></DialogContent></Dialog>
  </LibraryPageShell>;
}
