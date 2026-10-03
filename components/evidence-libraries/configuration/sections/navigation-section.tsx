"use client";

import { useTranslations } from "next-intl";
import { type LinkDraft, newLink } from "@/lib/evidence-libraries/configuration/links";
import { collectionOptions, newId, SCHEMA_LIMITS } from "@/lib/evidence-libraries/configuration/rules";
import {
  AddButton,
  EmptyList,
  FieldGroup,
  ListRow,
  move,
  NestedList,
  SortableList,
  ToggleRow,
} from "../fields";
import { SectionShell, type SectionProps } from "../section-shell";
import { LinkEditor } from "./link-editor";
import { MenuIcon } from "@/components/section-icons";

const LIMITS = SCHEMA_LIMITS.navigation;

export function NavigationSection({ draft, saved, patch, reset }: SectionProps) {
  const t = useTranslations("evidenceLibraryConfiguration.navigation");
  const links = draft.navigation.links;
  const collections = collectionOptions(draft);

  const setLinks = (update: (links: LinkDraft[]) => LinkDraft[]) =>
    patch((d) => {
      d.navigation.links = update(d.navigation.links);
      return d;
    });
  const updateLink = (linkId: string, update: (link: LinkDraft) => LinkDraft) =>
    setLinks((all) => all.map((link) => (link.id === linkId ? update(link) : link)));

  return (
    <SectionShell
      sectionKey="navigation"
      icon={MenuIcon}
      description={t("description")}
      draft={draft}
      saved={saved}
      reset={reset}
    >
      <ToggleRow
        label={t("showSearch")}
        hint={t("showSearchHint")}
        checked={draft.features.navbarSearch}
        data-navbar-search
        onChange={(checked) =>
          patch((d) => {
            d.features.navbarSearch = checked;
            return d;
          })
        }
      />

      <FieldGroup
        title={t("linksHeading")}
        action={
          <AddButton
            disabled={links.length >= LIMITS.links}
            onClick={() => setLinks((all) => [...all, newLink(newId("nav"))])}
          >
            {t("addLink")}
          </AddButton>
        }
      >
        {links.length === 0 ? (
          <EmptyList>{t("empty")}</EmptyList>
        ) : (
          <SortableList
            ids={links.map((link) => link.id)}
            onMove={(from, to) => setLinks((all) => move(all, from, to))}
          >
            {links.map((link) => (
              <ListRow
                key={link.id}
                id={link.id}
                removeLabel={t("removeLink")}
                onRemove={() => setLinks((all) => all.filter((x) => x.id !== link.id))}
                data-nav-link={link.id}
              >
                <LinkEditor
                  link={link}
                  collections={collections}
                  onChange={(next) => updateLink(link.id, () => next)}
                />
                <NestedList
                  label={t("childrenHeading")}
                  addLabel={t("addChild")}
                  disabled={link.children.length >= LIMITS.children}
                  onAdd={() =>
                    updateLink(link.id, (x) => ({
                      ...x,
                      children: [...x.children, newLink(newId("nav"))],
                    }))
                  }
                >
                  <SortableList
                    ids={link.children.map((child) => child.id)}
                    onMove={(from, to) =>
                      updateLink(link.id, (x) => ({ ...x, children: move(x.children, from, to) }))
                    }
                  >
                    {link.children.map((child) => (
                      <ListRow
                        key={child.id}
                        id={child.id}
                        removeLabel={t("removeChild")}
                        onRemove={() =>
                          updateLink(link.id, (x) => ({
                            ...x,
                            children: x.children.filter((c) => c.id !== child.id),
                          }))
                        }
                        data-nav-child={child.id}
                      >
                        <LinkEditor
                          link={child}
                          collections={collections}
                          showIcon={false}
                          onChange={(next) =>
                            updateLink(link.id, (x) => ({
                              ...x,
                              children: x.children.map((c) => (c.id === child.id ? next : c)),
                            }))
                          }
                        />
                      </ListRow>
                    ))}
                  </SortableList>
                </NestedList>
              </ListRow>
            ))}
          </SortableList>
        )}
        {links.length >= LIMITS.links ? (
          <p className="text-xs text-muted-foreground">{t("maxReached")}</p>
        ) : null}
      </FieldGroup>
    </SectionShell>
  );
}
