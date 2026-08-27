"use client";

import { useClerk } from "@clerk/nextjs";
import { Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { initialsOf } from "@/lib/evidence-libraries/initials";
import { EmptyList, FieldGroup } from "../fields";
import { SectionCard } from "../section-card";
import { StatusChip } from "../status-chip";

type Person = { clerkUserId: string; name: string; email: string };

/**
 * Who can work on the library. Owners are the organisation's admins and
 * editors its members; both lists come from the projected Clerk memberships.
 * People are managed in Clerk's organisation settings, opened from the card.
 */
export function TeamSection({
  libraryId,
}: {
  libraryId: Id<"evidenceLibraries">;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.team");
  const ts = useTranslations("evidenceLibraryConfiguration.sections");
  const { openOrganizationProfile } = useClerk();
  const { data } = useProtectedQuery(api.evidenceLibraries.queries.listTeam, {
    libraryId,
  });
  const org = data?.organizationName ?? "";
  return (
    <SectionCard
      id="sec-team"
      className="scroll-mt-40"
      icon={Users}
      title={ts("team")}
      description={t("description")}
      aside={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => openOrganizationProfile()}
        >
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
        <PeopleList
          role="editor"
          people={data?.editors}
          empty={t("noEditors")}
        />
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
    <ul
      className="divide-y divide-border/50 rounded-lg border border-border/50 bg-background"
      data-role={role}
    >
      {people.map((person) => {
        const known = Boolean(person.name || person.email);
        return (
          <li
            key={person.clerkUserId}
            className="flex items-center gap-3 px-3 py-2.5"
            data-pending={known ? undefined : true}
          >
            <Avatar className="size-8">
              <AvatarFallback className="text-xs text-muted-foreground">
                {initialsOf(person.name, person.email) || (
                  <Users className="size-3.5" aria-hidden />
                )}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              {known ? (
                <p className="truncate text-sm font-medium">
                  {person.name || person.email}
                </p>
              ) : (
                <StatusChip tone="neutral">{t("pending")}</StatusChip>
              )}
              {person.name && person.email ? (
                <p className="truncate text-xs text-muted-foreground">
                  {person.email}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
