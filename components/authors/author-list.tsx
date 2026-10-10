"use client";
import { useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { SignInButton, useUser } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { useSubscriptionState } from "@/lib/auth/use-subscription-state";
import { EVIDENCE_LIBRARIES_FEATURE } from "@/lib/billing/plans";
import { inWorkspace, useWorkspace, useWorkspaceMutation } from "@/lib/workspaces/url";
import { useWorkspaceRouter } from "@/lib/workspaces/href";
import Link from "@/components/workspace-link";
import { Users, Plus, ArrowUpRight, SearchX, AuthorsIcon } from "@/components/icons";
import { api } from "@/convex/_generated/api";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { BAR_ACTION, BAR_LABEL } from "@/components/evidence-libraries/configuration/panel-header";
import { Button } from "@/components/ui/button";
import { TooltipHint } from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { ListEmpty, ListLoading, ListSearch } from "@/components/evidence-libraries/list-controls";
import { AuthorAvatar } from "./author-avatar";
import { AuthorInvitations } from "./author-invitations";
import { Field, FieldError } from "@/components/evidence-libraries/configuration/section-card";
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogFooter } from "@/components/ui/dialog";

/**
 * `pending` renders the page before access is confirmed: the frame and
 * toolbar show at once and only the list waits.
 */
export function AuthorList({pending = false}: {pending?: boolean}) {
  const {isSignedIn} = useUser();
  const router = useWorkspaceRouter();
  const ta = useTranslations("auth");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const create = useWorkspaceMutation(api.authors.profiles.create);
  const {results, status, loadMore} = usePaginatedQuery(api.authors.profiles.directory, inWorkspace(useWorkspace(), pending ? "skip" : {search}), {initialNumItems: 20});
  // A profile is made in a workspace whose plan includes Evidence Libraries: someone a library was only shared with reads the directory and makes none.
  const {planFeatures} = useSubscriptionState();
  const noProfiles = planFeatures !== null && !planFeatures.includes(EVIDENCE_LIBRARIES_FEATURE) ? ta("organizationFeatureDescription") : undefined;
  // The page renders before sign-in finishes, so only a confirmed sign-out asks to sign in.
  const createLabel = <><Plus /><span className={BAR_LABEL}>Create author</span></>;
  return <LibraryPageShell icon={AuthorsIcon} title="Authors" actions={isSignedIn === false
    ? <SignInButton mode="modal"><Button size="sm" className={BAR_ACTION}>{createLabel}</Button></SignInButton>
    // Its wrapper stays hoverable while the button is off, so the reason shows.
    : <TooltipHint label={noProfiles}><span tabIndex={noProfiles ? 0 : undefined} className="inline-flex"><Button size="sm" className={BAR_ACTION} disabled={noProfiles !== undefined} onClick={() => {setError(""); setOpen(true);}}>{createLabel}</Button></span></TooltipHint>}
    filters={<ListSearch aria-label="Find authors" placeholder="Find an author…" className="w-56" value={search} onChange={event => setSearch(event.target.value)} />}>
    {!pending && <AuthorInvitations />}
    {!!results.length && <ul className="divide-y divide-border-subtle">{results.map(profile => <li key={profile._id} className="fade-enter"><Link href={`/authors/${profile._id}`} className="group flex items-center gap-3 p-4 hover:bg-muted">
      <AuthorAvatar photo={profile.photo} className="mr-1 size-10 shrink-0" />
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium group-hover:underline">{profile.name}</p><p className="truncate text-xs text-muted-foreground">{profile.headline || profile.affiliation}</p></div>
      <ArrowUpRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
    </Link></li>)}</ul>}
    {!results.length && (pending || status === "LoadingFirstPage"
      ? <ListLoading label="Loading authors" />
      : <ListEmpty icon={search ? SearchX : Users}>{search ? "No authors match your search." : "No authors yet."}</ListEmpty>)}
    {(status === "CanLoadMore" || status === "LoadingMore") && <div className="flex justify-center border-t border-border-subtle p-3"><Button variant="ghost" size="sm" disabled={status === "LoadingMore"} onClick={() => loadMore(20)}>{status === "LoadingMore" && <Spinner />}Show more</Button></div>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Create author profile</DialogTitle></DialogHeader><form className="space-y-4" onSubmit={async event => {
      event.preventDefault(); if (creating) return; setCreating(true); setError("");
      try { const id = await create({name}); router.push(`/authors/${id}/configuration`); setOpen(false); }
      catch (error) { setError(error instanceof Error ? error.message : "Could not create profile"); }
      finally { setCreating(false); }
    }}><Field label="Name">{id => <Input id={id} value={name} onChange={event => setName(event.target.value)} required maxLength={500} autoFocus />}</Field>{error && <FieldError>{error}</FieldError>}<DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={creating || !name.trim()}><Plus />Create profile</Button></DialogFooter></form></DialogContent></Dialog>
  </LibraryPageShell>;
}
