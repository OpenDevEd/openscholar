"use client";

import { useTranslations } from "next-intl";
import { Clock3, UserPlus, XCircle } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useOpenApply, type AppliedCommunity, type Standing } from "./apply-dialog";

/**
 * A public community's way in, on its card's corner: Apply, or where the person's application stands, which opens it.
 * Nothing for one they're in already, or whose owners turned applications off; signed in, nothing until their
 * standing with it is known (`standing` undefined), so the corner never shows Apply and then changes its mind.
 */
export function ApplyCorner({ community, standing, signedIn }: { community: AppliedCommunity; standing: Standing | undefined; signedIn: boolean }) {
  const t = useTranslations("communityApplications");
  const open = useOpenApply();
  if (signedIn && standing === undefined) return null;
  if (standing?.member) return null;
  const application = standing?.application ?? null;
  const waits = application?.state === "declined" && application.appliesAgainAt !== null && application.appliesAgainAt > Date.now();
  const [Icon, label] = application?.state === "waiting" ? [Clock3, t("applied")] as const
    : waits ? [XCircle, t("notAccepted")] as const
    : community.applicationsOpen ? [UserPlus, t("apply")] as const
    : [null, null] as const;
  if (!Icon) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      // Above the card's link, on its accent: a solid face reads on any colour.
      className="fade-enter absolute end-3 top-3 z-10 h-7 rounded-full border-transparent bg-background/95 px-2.5 text-xs shadow-sm backdrop-blur hover:bg-background"
      aria-label={t("applyFor", { label, name: community.name })}
      onClick={() => open({ community, standing: standing ?? null })}
    >
      <Icon className="size-3.5" />
      {label}
    </Button>
  );
}
