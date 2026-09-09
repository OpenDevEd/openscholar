"use client";
import { OpenAlexIcon } from "@/components/icons/openalex-icon";
import { ConfigurationNavigation } from "@/components/evidence-libraries/configuration/configuration-layout";
import { BookOpen, Link2, UserRound, Users } from "lucide-react";
import {
  RailGroup,
  RailLink,
} from "@/components/evidence-libraries/configuration/navigation-rail";
import { useScrollSpy } from "@/components/evidence-libraries/configuration/use-scroll-spy";
const sections = [
  ["profile-details", "Profile", UserRound],
  ["profile-links", "Links & identifiers", Link2],
  ["profile-publications", "Publications", BookOpen],
  ["profile-openalex", "OpenAlex", OpenAlexIcon],
  ["profile-access", "Access", Users],
] as const;
const editorSections = sections.filter(([id]) => id !== "profile-access");
const ownerIds = sections.map(([id]) => id);
const editorIds = editorSections.map(([id]) => id);
export function AuthorSettingsNavigation({canManageAccess}: {canManageAccess: boolean}) {
  const visibleSections = canManageAccess ? sections : editorSections;
  const ids = canManageAccess ? ownerIds : editorIds;
  const { active, jumpTo } = useScrollSpy(ids, 112);
  return (
    <ConfigurationNavigation label="Profile settings">
      <RailGroup label="Author profile">
        {visibleSections.map(([id, label, Icon]) => (
          <RailLink
            key={id}
            href={`#sec-${id}`}
            icon={Icon}
            active={(active ?? ids[0]) === id}
            onClick={() => jumpTo(id)}
          >
            {label}
          </RailLink>
        ))}
      </RailGroup>
    </ConfigurationNavigation>
  );
}
