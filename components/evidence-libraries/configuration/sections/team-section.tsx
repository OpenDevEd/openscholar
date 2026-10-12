"use client";

import { useUser } from "@clerk/nextjs";
import { Users } from "@/components/icons";
import { Spinner } from "@/components/ui/spinner";
import { SectionCard } from "../section-card";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useCurrentWorkspace } from "@/components/workspaces/parts";
import { TeamAccess, type AccessMember } from "./team-access";

export function TeamSection({ libraryId }: { libraryId: Id<"evidenceLibraries"> }) {
  const { user } = useUser();
  const { data } = useProtectedQuery(api.evidenceLibraries.queries.listTeam, { libraryId });
  const add = useMutation(api.evidenceLibraries.team.addOrganizationMember);
  const changeRole = useMutation(api.evidenceLibraries.team.changeRole);
  const remove = useMutation(api.evidenceLibraries.team.removeMember);
  const changeInvitation = useMutation(api.evidenceLibraries.invitations.change);
  const invite = useAction(api.evidenceLibraries.invitationActions.invite);
  // The workspace the page is in is the library's (components/workspaces/item-home.tsx): an organization's other members view it.
  const workspace = useCurrentWorkspace();
  if (!data || !workspace) return (
    <SectionCard id="sec-team" icon={Users} title="Team" description="Manage access to this library." aria-busy="true">
      <Spinner aria-label="Loading team" />
    </SectionCard>
  );
  const members: AccessMember[] = [
    ...data.owners.map(person => ({ ...person, id: person.clerkUserId, role: "Owner" as const, invited: false, you: person.clerkUserId === user?.id })),
    ...data.editors.map(person => ({ ...person, id: person.clerkUserId, role: "Editor" as const, invited: false, you: person.clerkUserId === user?.id })),
    ...data.creators.map(person => ({ ...person, id: person.clerkUserId, role: "Creator" as const, invited: false, you: person.clerkUserId === user?.id })),
    ...data.invitations.map(person => ({ id: person.invitationId, delivery: person.delivery, name: person.email.split("@")[0], email: person.email, role: person.role === "editor" ? "Editor" as const : "Creator" as const, invited: true })),
  ];
  const roleOf = (member: AccessMember) => member.role === "Editor" ? "editor" as const : "creator" as const;
  const resend = async (member: AccessMember) => { await invite({ libraryId, email: member.email, role: roleOf(member) }); };
  return <TeamAccess scope="library" members={members}
    libraryId={libraryId}
    organization={workspace.kind === "organization" ? workspace : undefined}
    onResend={resend}
    onMembersChange={async next => {
      for (const member of next) {
        const previous = members.find(m => m.id === member.id);
        if (!previous) {
          if (member.invited) await resend(member);
          else await add({ libraryId, clerkUserId: member.id, role: roleOf(member) });
        } else if (previous.role !== member.role) {
          if (member.invited) await changeInvitation({ invitationId: member.id as Id<"itemInvitations">, role: roleOf(member) });
          else await changeRole({ libraryId, clerkUserId: member.id, role: roleOf(member) });
        }
      }
      for (const member of members.filter(m => !next.some(n => n.id === m.id))) {
        if (member.invited) await changeInvitation({ invitationId: member.id as Id<"itemInvitations">, cancel: true });
        else await remove({ libraryId, clerkUserId: member.id });
      }
    }} />;
}
