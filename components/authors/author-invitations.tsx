"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { useRouter } from "next/navigation";
import { Check, Mail, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { readConvexErrorData } from "@/convex/lib/errors";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function AuthorInvitations({profileId, showEmpty = false}: {profileId?: Id<"authorProfiles">; showEmpty?: boolean}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const respond = useAction(api.authors.invitationActions.respond);
  const invitations = useProtectedQuery(api.authors.invitations.listInvitations, profileId ? {profileId} : {}).data?.page;
  if (!invitations) return showEmpty ? <div className="flex justify-center p-4"><Spinner aria-label="Loading invitation" /></div> : null;
  if (!invitations.length) return showEmpty ? <p className="rounded-xl bg-muted/30 p-4 text-sm text-muted-foreground">No pending invitation for this profile. Check that you are signed in with the invited email address.</p> : null;
  return invitations.map(invitation => <div key={invitation.invitationId} className="flex flex-wrap items-center gap-3 border-b border-border/50 bg-muted/20 px-4 py-3">
    <Mail className="size-4 shrink-0 text-primary" /><p className="min-w-0 flex-1 text-sm">Invitation to edit <span className="font-medium">{invitation.name}</span></p>
    <div className="flex items-center gap-2">{[true, false].map(accept => <Button key={String(accept)} size="sm" variant="outline" disabled={pending} onClick={async () => {
      setPending(true);
      try {
        await respond({invitationId: invitation.invitationId, accept});
        router.push(`/authors/${invitation.profileId}${accept ? "/configuration" : ""}`);
      } catch (error) { toast.error(readConvexErrorData(error)?.message ?? "Could not respond to invitation. Try again."); }
      finally { setPending(false); }
    }}>{accept ? <Check /> : <X />}{accept ? "Accept" : "Decline"}</Button>)}</div>
  </div>);
}
