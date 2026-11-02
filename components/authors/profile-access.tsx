"use client";
import { useTranslations } from "next-intl";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { TeamAccess, type AccessMember } from "@/components/evidence-libraries/configuration/sections/team-access";

/**
 * A profile's owners and editors. Its editors are its guests (#653): they're invited and removed
 * as any shared item's are, in the workspace that owns the profile, whichever one its page is in.
 */
export function ProfileAccess({profileId, workspaceId}: {profileId: Id<"authorProfiles">; workspaceId: Id<"workspaces">}) {
  const t = useTranslations("authorPages");
  const data = useQuery(api.authors.members.list, {profileId});
  const invite = useAction(api.sharing.invitations.invite);
  const remove = useMutation(api.sharing.guests.remove);
  if (!data || data.role !== "owner") return null;
  const item = {workspaceId, kind: "author" as const, id: profileId};
  const members: AccessMember[] = [
    ...data.members.map(person => ({...person, id: person.userId, role: person.role === "owner" ? "Owner" as const : "Editor" as const, invited: false})),
    ...data.invitations.map(invitation => ({id: invitation._id, name: invitation.email.split("@")[0], email: invitation.email, role: "Editor" as const, invited: true, delivery: invitation.delivery})),
  ];
  return <TeamAccess scope="profile" members={members}
    onResend={async member => { await invite({...item, email: member.email, role: "editor"}); }}
    onMembersChange={async next => {
      for (const member of next) if (!members.some(previous => previous.id === member.id)) await invite({...item, email: member.email, role: "editor"});
      for (const member of members) if (!next.some(person => person.id === member.id)) {
        await remove({...item, guest: member.invited ? {email: member.email} : {userId: member.id as Id<"users">}});
      }
    }} />;
}
