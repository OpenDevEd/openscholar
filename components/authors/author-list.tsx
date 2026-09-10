"use client";
import { useState } from "react";
import { useMutation, usePaginatedQuery, useAction } from "convex/react";
import { SignInButton, useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Users, Plus, Search, ArrowUpRight, Mail, Check, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Field, FieldError } from "@/components/evidence-libraries/configuration/section-card";
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";

export function AuthorList() {
  const {isSignedIn} = useUser();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const create = useMutation(api.authors.profiles.create);
  const respond = useAction(api.authors.invitationActions.respond);
  const {data: invitations} = useProtectedQuery(api.authors.invitations.listMine, {});
  const {results, status, loadMore} = usePaginatedQuery(api.authors.profiles.list, {search}, {initialNumItems: 20});
  return <LibraryPageShell icon={Users} title="Authors" actions={isSignedIn
    ? <Button onClick={() => {setError(""); setOpen(true);}}><Plus />Create author</Button>
    : <SignInButton mode="modal"><Button><Plus />Create author</Button></SignInButton>}>
    {invitations?.map(invitation => <div key={invitation.invitationId} className="flex items-center gap-3 border-b border-border/50 bg-muted/20 px-4 py-3">
      <Mail className="size-4 shrink-0 text-primary" /><p className="min-w-0 flex-1 text-sm">Invitation to edit <span className="font-medium">{invitation.name}</span></p>
      {[true, false].map(accept => <Button key={String(accept)} size="sm" variant="outline" disabled={pending} onClick={async () => {
        setPending(true); try { await respond({invitationId: invitation.invitationId, accept}); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not respond to invitation"); } finally { setPending(false); }
      }}>{accept ? <Check /> : <X />}{accept ? "Accept" : "Decline"}</Button>)}
    </div>)}
    <div className="border-b border-border/50 p-4"><div className="relative max-w-sm"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" aria-label="Find authors" placeholder="Find an author" value={search} onChange={event => setSearch(event.target.value)} /></div></div>
    {results.map(profile => <Link key={profile._id} href={`/authors/${profile._id}`} className="flex items-center gap-4 border-b border-border/50 px-4 py-4 transition-colors last:border-b-0 hover:bg-muted/20 sm:px-6">
      <Avatar className="size-12 shrink-0 rounded-xl"><AvatarImage src={profile.photo ?? undefined} alt="" /><AvatarFallback className="rounded-xl bg-primary/10 text-primary">{profile.name.split(/\s+/).map(part => part[0]).slice(0, 2).join("")}</AvatarFallback></Avatar>
      <div className="min-w-0 flex-1"><p className="truncate font-semibold">{profile.name}</p><p className="mt-1 truncate text-sm text-muted-foreground">{profile.headline || profile.affiliation}</p></div>
      <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>)}
    {!results.length && (status === "LoadingFirstPage"
      ? <div className="flex min-h-40 items-center justify-center"><Spinner aria-label="Loading authors" className="size-6 text-primary" /></div>
      : <p className="p-6 text-sm text-muted-foreground">No authors found.</p>)}
    {(status === "CanLoadMore" || status === "LoadingMore") && <div className="flex justify-center border-t border-border/50 p-3"><Button variant="ghost" size="sm" disabled={status === "LoadingMore"} onClick={() => loadMore(20)}>{status === "LoadingMore" && <Spinner />}Show more</Button></div>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Create author profile</DialogTitle></DialogHeader><form className="space-y-4" onSubmit={async event => {
      event.preventDefault(); if (pending) return; setPending(true); setError("");
      try { const id = await create({name}); router.push(`/authors/${id}/configuration`); setOpen(false); }
      catch (error) { setError(error instanceof Error ? error.message : "Could not create profile"); }
      finally { setPending(false); }
    }}><Field label="Name">{id => <Input id={id} value={name} onChange={event => setName(event.target.value)} required maxLength={500} autoFocus />}</Field>{error && <FieldError>{error}</FieldError>}<DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending || !name.trim()}><Plus />Create profile</Button></DialogFooter></form></DialogContent></Dialog>
  </LibraryPageShell>;
}
