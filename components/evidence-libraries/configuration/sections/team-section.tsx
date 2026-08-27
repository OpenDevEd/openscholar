"use client";

import { useClerk } from "@clerk/nextjs";
import { Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { initialsOf } from "@/lib/evidence-libraries/configuration/team";
import { EmptyList, FieldGroup } from "../fields";
import { SectionCard } from "../section-card";

type Person = { clerkUserId: string; name: string; email: string };

/**
 * Who can work on the library. Owners are the organisation's admins and
 * editors its members; both lists come from the projected Clerk memberships.
 * People are managed in Clerk's organisation settings, opened from the card.
 */
export function TeamSection({ libraryId }: { libraryId: Id<"evidenceLibraries"> }) {
  const t = useTranslations("evidenceLibraryConfiguration.team");
  const ts = useTranslations("evidenceLibraryConfiguration.sections");
  const { openOrganizationProfile } = useClerk();
  const { data } = useProtectedQuery(api.evidenceLibraries.queries.listTeam, { libraryId });
  const org = data?.organizationName ?? "";
  return (
    <SectionCard
      id="sec-team"
      className="scroll-mt-40"
      icon={Users}
      title={ts("team")}
      description={t("description")}
      aside={
        <Button type="button" variant="outline" size="sm" onClick={() => openOrganizationProfile()}>
          <Users />
          {t("manageButton")}
        </Button>
      }
      data-organization={org}
    >
      <FieldGroup title={t("ownersTitle")} hint={t("ownersHint", { org })}>
        <PeopleList role="owner" people={data?.owners} empty={t("noOwners")} />
      </FieldGroup>
      <FieldGroup title={t("editorsTitle")} hint={t("editorsHint", { org })}>
        <PeopleList role="editor" people={data?.editors} empty={t("noEditors")} />
      </FieldGroup>
    </SectionCard>
  );
}

function PeopleList({
  role,
  people,
  empty,
}: {
  role: "owner" | "editor";
  people: Person[] | undefined;
  empty: string;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.team");
  if (!people) return null;
  if (people.length === 0) return <EmptyList>{empty}</EmptyList>;
  return (
    <ul className="divide-y divide-border/50 rounded-lg border border-border/50 bg-background" data-role={role}>
      {people.map((person) => {
        const title = person.name || person.email || t("pending");
        return (
          <li key={person.clerkUserId} className="flex items-center gap-3 px-3 py-2.5">
            <Avatar>
              <AvatarFallback className="text-xs">{initialsOf(person.name, person.email)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{title}</p>
              {person.name && person.email ? (
                <p className="truncate text-xs text-muted-foreground">{person.email}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
