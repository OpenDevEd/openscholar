"use client";

import { useState } from "react";
import { useWorkspaceRouter } from "@/lib/workspaces/href";
import { Check, Mail, X } from "@/components/icons";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { readConvexErrorData } from "@/convex/lib/errors";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { Button } from "@/components/ui/button";
import { useWorkspaceAction } from "@/lib/workspaces/url";

/** The invitations to edit a profile that wait for the person, on the Authors page; each is answered as any shared item's is (#653). */
export function AuthorInvitations() {
  const router = useWorkspaceRouter();
  const [pending, setPending] = useState(false);
  const respond = useWorkspaceAction(api.sharing.invitations.respond);
  const invitations = useProtectedQuery(api.authors.invitations.listInvitations, {}).data?.page;
  if (!invitations?.length) return null;
  return invitations.map(invitation => <div key={invitation.invitationId} className="flex flex-wrap items-center gap-3 border-b border-border-subtle bg-inset px-4 py-3">
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
