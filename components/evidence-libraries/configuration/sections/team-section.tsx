"use client";

import { useClerk, useOrganization } from "@clerk/nextjs";
import { Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { PanelRow } from "../fields";
import { SectionCard } from "../section-card";

/**
 * Who can manage and edit the library. Read-only this version: the roles come
 * from the Clerk organisation, so people are managed in its settings modal
 * (the same one the sidebar organisation switcher opens).
 */
export function TeamSection() {
  const t = useTranslations("evidenceLibraryConfiguration");
  const { organization } = useOrganization();
  const { openOrganizationProfile } = useClerk();
  const org = organization?.name ?? "";
  return (
    <SectionCard
      id="sec-team"
      className="scroll-mt-40"
      icon={Users}
      title={t("sections.team")}
      description={t("team.description")}
      data-organization={org}
    >
      <PanelRow
        tone="muted"
        title={t("team.ownersTitle")}
        hint={t("team.ownersHint", { org })}
      />
      <PanelRow
        tone="muted"
        title={t("team.editorsTitle")}
        hint={t("team.editorsHint", { org })}
      />
      <PanelRow
        tone="plain"
        title={t("team.manageTitle")}
        hint={t("team.manageHint")}
        action={
          <Button
            type="button"
            variant="outline"
            onClick={() => openOrganizationProfile()}
          >
            <Users />
            {t("team.manageButton")}
          </Button>
        }
      />
    </SectionCard>
  );
}
