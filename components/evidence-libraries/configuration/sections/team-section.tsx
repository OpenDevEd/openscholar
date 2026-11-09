"use client";

import { useTranslations } from "next-intl";
import { useUser } from "@clerk/nextjs";
import { Users } from "@/components/icons";
import { Spinner } from "@/components/ui/spinner";
import { SectionCard } from "../section-card";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { TeamAccess, type AccessMember } from "./team-access";
import { useWithPage } from "../preloads";

/** The community's team: its owners manage it, and everyone else who opens its settings sees it, read-only (`readOnly`). */
export function TeamSection({ libraryId, readOnly = false }: { libraryId: Id<"evidenceLibraries">; readOnly?: boolean }) {
  const tLabels = useTranslations("libraryTeamAccess");
  const t = useTranslations("libraryTeamAccess");
  const { user } = useUser();
  const data = useWithPage<typeof api.evidenceLibraries.queries.listTeam>("team", useProtectedQuery(api.evidenceLibraries.queries.listTeam, { libraryId }).data);
  const add = useMutation(api.evidenceLibraries.team.addOrganizationMember);
  const changeRole = useMutation(api.evidenceLibraries.team.changeRole);
  const remove = useMutation(api.evidenceLibraries.team.removeMember);
  const changeInvitation = useMutation(api.evidenceLibraries.invitations.change);
  const invite = useAction(api.evidenceLibraries.invitationActions.invite);
  const grantOrganization = useMutation(api.evidenceLibraries.organizationGrants.grant);
  const changeOrganizationRole = useMutation(api.evidenceLibraries.organizationGrants.changeRole);
  const removeOrganization = useMutation(api.evidenceLibraries.organizationGrants.remove);
  if (!data) return (
    <SectionCard id="sec-team" icon={Users} title={t("team")} description={t("manageAccessToThisLibrary")} aria-busy="true">
      <Spinner aria-label={t("loadingTeam")} />
    </SectionCard>
  );
  const members: AccessMember[] = [
    ...data.owners.map(person => ({ ...person, id: person.clerkUserId, role: "Owner" as const, invited: false, you: person.clerkUserId === user?.id })),
    ...data.editors.map(person => ({ ...person, id: person.clerkUserId, role: "Editor" as const, invited: false, you: person.clerkUserId === user?.id })),
    ...data.creators.map(person => ({ ...person, id: person.clerkUserId, role: "Creator" as const, invited: false, you: person.clerkUserId === user?.id })),
    // The organizations it's shared with (#1091), each as one row.
    ...data.organizations.map(row => ({ id: row.organizationId, name: row.name, email: "", role: row.role === "editor" ? "Editor" as const : "Creator" as const, invited: false, organization: { kind: "organization" as const, name: row.name, ...(row.imageUrl ? { imageUrl: row.imageUrl } : {}), ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}), ...(row.colour ? { colour: row.colour } : {}) } })),
    ...data.invitations.map(person => ({ id: person.invitationId, delivery: person.delivery, name: person.email.split("@")[0], email: person.email, role: person.role === "editor" ? "Editor" as const : "Creator" as const, invited: true, toOrganization: person.toOrganization })),
  ];
  const roleOf = (member: AccessMember) => member.role === "Editor" ? "editor" as const : "creator" as const;
  const resend = async (member: AccessMember) => { await invite({ libraryId, email: member.email, role: roleOf(member), ...(member.toOrganization ? { toOrganization: true } : {}) }); };
  const organizationOf = (member: AccessMember) => member.id as Id<"organizations">;
  return <TeamAccess scope="library" members={members} readOnly={readOnly}
    libraryId={libraryId}
    // The organization that owns it, as the team read it: a guest opens its page from their own workspace.
    organization={data.owningOrganization ? { kind: "organization", name: data.owningOrganization.name, workspaceId: data.owningOrganization.workspaceId, ...(data.owningOrganization.imageUrl ? { imageUrl: data.owningOrganization.imageUrl } : {}), ...(data.owningOrganization.colour ? { colour: data.owningOrganization.colour } : {}) } : undefined}
    onResend={resend}
    onMembersChange={async next => {
      for (const member of next) {
        const previous = members.find(m => m.id === member.id);
        if (!previous) {
          if (member.invited) await resend(member);
          else if (member.organization) await grantOrganization({ libraryId, organizationId: organizationOf(member), role: roleOf(member) });
          else await add({ libraryId, clerkUserId: member.id, role: roleOf(member) });
        } else if (previous.role !== member.role) {
          if (member.invited) await changeInvitation({ invitationId: member.id as Id<"itemInvitations">, role: roleOf(member) });
          else if (member.organization) await changeOrganizationRole({ libraryId, organizationId: organizationOf(member), role: roleOf(member) });
          else await changeRole({ libraryId, clerkUserId: member.id, role: roleOf(member) });
        }
      }
      for (const member of members.filter(m => !next.some(n => n.id === m.id))) {
        if (member.invited) await changeInvitation({ invitationId: member.id as Id<"itemInvitations">, cancel: true });
        else if (member.organization) await removeOrganization({ libraryId, organizationId: organizationOf(member) });
        else await remove({ libraryId, clerkUserId: member.id });
      }
    }} />;
}
