"use client";

import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { TeamAccess, type AccessMember } from "./team-access";

export function TeamSection({ libraryId }: { libraryId: Id<"evidenceLibraries"> }) {
  const { data } = useProtectedQuery(api.evidenceLibraries.queries.listTeam, { libraryId });
  const add = useMutation(api.evidenceLibraries.team.addOrganizationMember);
  const changeRole = useMutation(api.evidenceLibraries.team.changeRole);
  const remove = useMutation(api.evidenceLibraries.team.removeMember);
  const changeInvitation = useMutation(api.evidenceLibraries.invitations.change);
  const invite = useAction(api.evidenceLibraries.invitationActions.invite);
  if (!data) return null;
  const members: AccessMember[] = [
    ...data.owners.map(person => ({ ...person, id: person.clerkUserId, role: "Owner" as const, invited: false })),
    ...data.editors.map(person => ({ ...person, id: person.clerkUserId, role: "Editor" as const, invited: false })),
    ...data.creators.map(person => ({ ...person, id: person.clerkUserId, role: "Creator" as const, invited: false })),
    ...data.invitations.map(person => ({ id: person.invitationId, name: person.email.split("@")[0], email: person.email, role: person.role === "editor" ? "Editor" as const : "Creator" as const, invited: true })),
  ];
  const roleOf = (member: AccessMember) => member.role === "Editor" ? "editor" as const : "creator" as const;
  const resend = async (member: AccessMember) => { await invite({ libraryId, email: member.email, role: roleOf(member) }); };
  return <TeamAccess scope="library" members={members}
    organizationPeople={data.availablePeople.map(person => ({ ...person, id: person.clerkUserId }))}
    onResend={resend}
    onMembersChange={async next => {
      for (const member of next) {
        const previous = members.find(m => m.id === member.id);
        if (!previous) {
          if (member.invited) await resend(member);
          else await add({ libraryId, clerkUserId: member.id, role: roleOf(member) });
        } else if (previous.role !== member.role) {
          if (member.invited) await changeInvitation({ invitationId: member.id as Id<"evidenceLibraryInvitations">, role: roleOf(member) });
          else await changeRole({ libraryId, clerkUserId: member.id, role: roleOf(member) });
        }
      }
      for (const member of members.filter(m => !next.some(n => n.id === m.id))) {
        if (member.invited) await changeInvitation({ invitationId: member.id as Id<"evidenceLibraryInvitations">, cancel: true });
        else await remove({ libraryId, clerkUserId: member.id });
      }
    }} />;
}
