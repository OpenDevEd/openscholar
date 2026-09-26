"use client";
import { useState } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
import { SignInButton, useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Users, Plus, ArrowUpRight, SearchX } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { Button } from "@/components/ui/button";
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
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const create = useMutation(api.authors.profiles.create);
  const {results, status, loadMore} = usePaginatedQuery(api.authors.profiles.list, pending ? "skip" : {search}, {initialNumItems: 20});
  // The page renders before sign-in finishes, so only a confirmed sign-out asks to sign in.
  return <LibraryPageShell icon={Users} title="Authors" actions={isSignedIn === false
    ? <SignInButton mode="modal"><Button><Plus />Create author</Button></SignInButton>
    : <Button onClick={() => {setError(""); setOpen(true);}}><Plus />Create author</Button>}>
    {!pending && <AuthorInvitations />}
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 p-4"><ListSearch aria-label="Find authors" placeholder="Find an author…" className="w-56" value={search} onChange={event => setSearch(event.target.value)} /></div>
    {!!results.length && <ul className="divide-y divide-border/50">{results.map(profile => <li key={profile._id} className="fade-enter"><Link href={`/authors/${profile._id}`} className="group flex items-center gap-3 p-4 hover:bg-muted/15">
      <AuthorAvatar photo={profile.photo} className="mr-1 size-10 shrink-0" />
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium group-hover:underline">{profile.name}</p><p className="truncate text-xs text-muted-foreground">{profile.headline || profile.affiliation}</p></div>
      <ArrowUpRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
    </Link></li>)}</ul>}
    {!results.length && (pending || status === "LoadingFirstPage"
      ? <ListLoading label="Loading authors" />
      : <ListEmpty icon={search ? SearchX : Users}>{search ? "No authors match your search." : "No authors yet."}</ListEmpty>)}
    {(status === "CanLoadMore" || status === "LoadingMore") && <div className="flex justify-center border-t border-border/50 p-3"><Button variant="ghost" size="sm" disabled={status === "LoadingMore"} onClick={() => loadMore(20)}>{status === "LoadingMore" && <Spinner />}Show more</Button></div>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Create author profile</DialogTitle></DialogHeader><form className="space-y-4" onSubmit={async event => {
      event.preventDefault(); if (creating) return; setCreating(true); setError("");
      try { const id = await create({name}); router.push(`/authors/${id}/configuration`); setOpen(false); }
      catch (error) { setError(error instanceof Error ? error.message : "Could not create profile"); }
      finally { setCreating(false); }
    }}><Field label="Name">{id => <Input id={id} value={name} onChange={event => setName(event.target.value)} required maxLength={500} autoFocus />}</Field>{error && <FieldError>{error}</FieldError>}<DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={creating || !name.trim()}><Plus />Create profile</Button></DialogFooter></form></DialogContent></Dialog>
  </LibraryPageShell>;
}
