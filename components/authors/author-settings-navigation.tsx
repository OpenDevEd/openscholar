"use client";
import { OpenAlexIcon } from "@/components/icons/openalex-icon";
import { ConfigurationNavigation } from "@/components/evidence-libraries/configuration/configuration-layout";
import {
  RailGroup,
  RailLink,
} from "@/components/evidence-libraries/configuration/navigation-rail";
import { useScrollSpy } from "@/components/evidence-libraries/configuration/use-scroll-spy";
import { TeamIcon, PersonIcon, LinkIcon, BookIcon } from "@/components/section-icons";
const sections = [
  ["profile-details", "Profile", PersonIcon],
  ["profile-links", "Links & identifiers", LinkIcon],
  ["profile-publications", "Publications", BookIcon],
  ["profile-openalex", "OpenAlex", OpenAlexIcon],
  ["profile-access", "Access", TeamIcon],
] as const;
const editorSections = sections.filter(([id]) => id !== "profile-access");
const ownerIds = sections.map(([id]) => id);
const editorIds = editorSections.map(([id]) => id);
export function AuthorSettingsNavigation({canManageAccess}: {canManageAccess: boolean}) {
  const visibleSections = canManageAccess ? sections : editorSections;
  const ids = canManageAccess ? ownerIds : editorIds;
  const { active, jumpTo } = useScrollSpy(ids);
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
