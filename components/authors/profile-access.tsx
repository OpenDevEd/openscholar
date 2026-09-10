"use client";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { TeamAccess, type AccessMember } from "@/components/evidence-libraries/configuration/sections/team-access";

export function ProfileAccess({profileId}: {profileId: Id<"authorProfiles">}) {
  const data = useQuery(api.authors.members.list, {profileId});
  const invite = useAction(api.authors.invitationActions.invite);
  const cancel = useMutation(api.authors.invitations.cancel);
  const remove = useMutation(api.authors.members.remove);
  if (!data || data.role !== "owner") return null;
  const members: AccessMember[] = [
    ...data.members.map(person => ({...person, id: person.userId, role: person.role === "owner" ? "Owner" as const : "Editor" as const, invited: false})),
    ...data.invitations.map(invitation => ({id: invitation._id, name: invitation.email.split("@")[0], email: invitation.email, role: "Editor" as const, invited: true, delivery: invitation.delivery})),
  ];
  return <TeamAccess scope="profile" members={members} organizationPeople={[]}
    onResend={async member => { await invite({profileId, email: member.email}); }}
    onMembersChange={async next => {
      for (const member of next) if (!members.some(previous => previous.id === member.id)) await invite({profileId, email: member.email});
      for (const member of members) if (!next.some(person => person.id === member.id)) {
        if (member.invited) await cancel({invitationId: member.id as Id<"authorProfileInvitations">});
        else await remove({profileId, userId: member.id as Id<"users">});
      }
    }} />;
}
