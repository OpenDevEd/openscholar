"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Eye } from "@/components/icons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { useWorkspaceMutation } from "@/lib/workspaces/url";
import { ChoiceCards, ToggleRow } from "../fields";
import { SectionCard } from "../section-card";

type Visibility = "public" | "unlisted";

/**
 * Whether the community is listed in the public directory of communities (#1090). Not a draft
 * section: it changes at once and is never published, and the site stays open to anyone with its
 * address either way.
 */
export function ListingSection({ libraryId, unlisted, applicationsClosed }: { libraryId: string; unlisted: boolean; applicationsClosed: boolean }) {
  const t = useTranslations("evidenceLibraryConfiguration");
  const tc = useTranslations("common");
  const ta = useTranslations("communityApplications");
  const setVisibility = useWorkspaceMutation(api.evidenceLibraries.assistant.setVisibility);
  // The choice shows at once; the saved one takes over when it arrives, and a refusal puts it back.
  const [chosen, choose] = useState<Visibility | null>(null);
  const saved: Visibility = unlisted ? "unlisted" : "public";
  const listed = (chosen ?? saved) === "public";
  if (chosen === saved) choose(null);
  // Applications to join (OS-31), on unless its owners turned them off: the switch moves at once, as the choice above does.
  const setApplicationsOpen = useWorkspaceMutation(api.evidenceLibraries.applications.setOpen);
  const [openChosen, chooseOpen] = useState<boolean | null>(null);
  if (openChosen === !applicationsClosed) chooseOpen(null);
  const open = openChosen ?? !applicationsClosed;
  const setOpen = async (next: boolean) => {
    chooseOpen(next);
    try {
      await setApplicationsOpen({ libraryId: libraryId as Id<"evidenceLibraries">, open: next });
    } catch (error) {
      chooseOpen(null);
      toast.error(getErrorMessage(error, tc("somethingWentWrong")));
    }
  };
  const change = async (visibility: Visibility) => {
    choose(visibility);
    try {
      await setVisibility({ libraryId: libraryId as Id<"evidenceLibraries">, visibility });
    } catch (error) {
      choose(null);
      toast.error(getErrorMessage(error, tc("somethingWentWrong")));
    }
  };
  return (
    <SectionCard id="sec-listing" icon={Eye} title={t("sections.listing")} description={t("listing.description")}>
      <ChoiceCards<Visibility>
        value={chosen ?? saved}
        onChange={(visibility) => void change(visibility)}
        ariaLabel={t("sections.listing")}
        options={[
          { value: "public", label: t("listing.public"), hint: t("listing.publicHint") },
          { value: "unlisted", label: t("listing.unlisted"), hint: t("listing.unlistedHint") },
        ]}
      />
      {/* Unlisted, nobody finds it to apply: the switch stays, off, saying why. */}
      <ToggleRow
        className="mt-3"
        label={ta("letPeopleApply")}
        hint={ta("letPeopleApplyHint")}
        checked={listed && open}
        onChange={(next) => void setOpen(next)}
        locked={!listed}
        disabledReason={ta("onlyPublic")}
      />
    </SectionCard>
  );
}
