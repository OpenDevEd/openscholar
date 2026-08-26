"use client";

import { Menu } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  BUILT_IN_PAGES,
  type BuiltInPageKey,
  type CollectionSetting,
  NAV_ICONS,
  type NavIcon,
  type NavLink,
  type NavTarget,
  newId,
} from "@/lib/evidence-libraries/mock/config";
import { Field } from "../section-card";
import {
  AddButton,
  EmptyList,
  ListRow,
  move,
  NestedList,
  SortableList,
  ToggleRow,
} from "./fields";
import { SectionShell, type SectionProps } from "./section-shell";

export const MAX_NAV_LINKS = 12;

const NO_ICON = "__none";

export function newNavLink(): NavLink {
  return {
    id: newId("nav"),
    label: "",
    target: { kind: "page", page: "home" },
    icon: "",
    newTab: false,
    visible: true,
    children: [],
  };
}

const isHttps = (v: string) => /^https:\/\/\S+$/.test(v);

function retarget(
  kind: NavTarget["kind"],
  collections: CollectionSetting[],
): NavTarget {
  if (kind === "page") return { kind: "page", page: "home" };
  if (kind === "collection")
    return { kind: "collection", collectionId: collections[0]?.id ?? "" };
  return { kind: "url", url: "" };
}

/**
 * Editor for one navigation link. Shared with the footer section, which
 * hides the icon picker and the nested dropdown items.
 */
export function LinkEditor({
  link,
  collections,
  onChange,
  showIcon = true,
}: {
  link: NavLink;
  collections: CollectionSetting[];
  onChange: (link: NavLink) => void;
  showIcon?: boolean;
}) {
  const t = useTranslations("evidenceLibraryMock.config.navigation");
  const target = link.target;
  const urlError =
    target.kind === "url" && !isHttps(target.url) ? t("urlError") : null;
  const collectionError =
    target.kind === "collection" && collections.length === 0
      ? t("noCollections")
      : null;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={t("labelLabel")}
          error={!link.label.trim() ? t("labelError") : null}
        >
          {(id, invalid) => (
            <Input
              id={id}
              className="bg-background"
              value={link.label}
              aria-invalid={invalid || undefined}
              placeholder={t("labelPlaceholder")}
              onChange={(e) => onChange({ ...link, label: e.target.value })}
            />
          )}
        </Field>
        <Field label={t("kindLabel")}>
          {(id) => (
            <Select
              value={target.kind}
              onValueChange={(kind) =>
                onChange({
                  ...link,
                  target: retarget(kind as NavTarget["kind"], collections),
                })
              }
            >
              <SelectTrigger id={id} className="w-full bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="page">{t("kinds.page")}</SelectItem>
                <SelectItem value="collection">
                  {t("kinds.collection")}
                </SelectItem>
                <SelectItem value="url">{t("kinds.url")}</SelectItem>
              </SelectContent>
            </Select>
          )}
        </Field>
      </div>

      {target.kind === "page" ? (
        <Field label={t("pageLabel")}>
          {(id) => (
            <Select
              value={target.page}
              onValueChange={(page) =>
                onChange({
                  ...link,
                  target: { kind: "page", page: page as BuiltInPageKey },
                })
              }
            >
              <SelectTrigger id={id} className="w-full bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUILT_IN_PAGES.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {t(`pages.${p.key}`)}
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {p.path}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
      ) : null}

      {target.kind === "collection" ? (
        <Field label={t("collectionLabel")} error={collectionError}>
          {(id, invalid) => (
            <Select
              value={target.collectionId || undefined}
              disabled={collections.length === 0}
              onValueChange={(collectionId) =>
                onChange({
                  ...link,
                  target: { kind: "collection", collectionId },
                })
              }
            >
              <SelectTrigger
                id={id}
                className="w-full bg-background"
                aria-invalid={invalid || undefined}
              >
                <SelectValue placeholder={t("collectionPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {collections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.title || c.sourceTitle}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
      ) : null}

      {target.kind === "url" ? (
        <Field label={t("urlLabel")} error={urlError}>
          {(id, invalid) => (
            <Input
              id={id}
              className="bg-background font-mono text-sm"
              value={target.url}
              inputMode="url"
              placeholder="https://"
              aria-invalid={invalid || undefined}
              onChange={(e) =>
                onChange({
                  ...link,
                  target: { kind: "url", url: e.target.value },
                })
              }
            />
          )}
        </Field>
      ) : null}

      <div className="flex flex-wrap items-end gap-4">
        {showIcon ? (
          <Field label={t("iconLabel")} className="min-w-44 flex-1">
            {(id) => (
              <Select
                value={link.icon || NO_ICON}
                onValueChange={(icon) =>
                  onChange({
                    ...link,
                    icon: icon === NO_ICON ? "" : (icon as NavIcon),
                  })
                }
              >
                <SelectTrigger id={id} className="w-full bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ICON}>{t("noIcon")}</SelectItem>
                  {NAV_ICONS.map((icon) => (
                    <SelectItem key={icon} value={icon}>
                      <span className="font-mono text-xs">{icon}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        ) : null}
        {target.kind === "url" ? (
          <SmallSwitch
            label={t("newTab")}
            checked={link.newTab}
            onChange={(newTab) => onChange({ ...link, newTab })}
          />
        ) : null}
        <SmallSwitch
          label={t("visible")}
          checked={link.visible}
          onChange={(visible) => onChange({ ...link, visible })}
        />
      </div>
    </div>
  );
}

function SmallSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex h-9 items-center gap-2">
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        className="scale-90"
      />
      <Label htmlFor={id} className="text-xs font-normal">
        {label}
      </Label>
    </div>
  );
}

export function NavigationSection({ library, patch }: SectionProps) {
  const t = useTranslations("evidenceLibraryMock.config.navigation");
  const { links, showSearch } = library.draft.navigation;
  const collections = library.draft.collections;

  const setLinks = (update: (links: NavLink[]) => NavLink[]) =>
    patch((d) => {
      d.navigation.links = update(d.navigation.links);
      return d;
    });

  return (
    <SectionShell
      sectionKey="navigation"
      icon={Menu}
      description={t("description")}
      library={library}
    >
      <ToggleRow
        label={t("showSearch")}
        hint={t("showSearchHint")}
        checked={showSearch}
        onChange={(v) =>
          patch((d) => {
            d.navigation.showSearch = v;
            return d;
          })
        }
      />

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">
          {t("linksHeading", { count: links.length, max: MAX_NAV_LINKS })}
        </p>
        {links.length === 0 ? <EmptyList>{t("empty")}</EmptyList> : null}
        <SortableList
          ids={links.map((l) => l.id)}
          onMove={(from, to) => setLinks((l) => move(l, from, to))}
        >
          {links.map((link) => (
            <ListRow
              key={link.id}
              id={link.id}
              removeLabel={t("removeLink")}
              onRemove={() =>
                setLinks((l) => l.filter((x) => x.id !== link.id))
              }
              data-nav-link={link.id}
            >
              <LinkEditor
                link={link}
                collections={collections}
                onChange={(next) =>
                  setLinks((l) => l.map((x) => (x.id === link.id ? next : x)))
                }
              />
              <NestedList
                label={t("childrenHeading")}
                addLabel={t("addChild")}
                disabled={link.children.length >= MAX_NAV_LINKS}
                onAdd={() =>
                  setLinks((l) =>
                    l.map((x) =>
                      x.id === link.id
                        ? { ...x, children: [...x.children, newNavLink()] }
                        : x,
                    ),
                  )
                }
              >
                <SortableList
                  ids={link.children.map((c) => c.id)}
                  onMove={(from, to) =>
                    setLinks((l) =>
                      l.map((x) =>
                        x.id === link.id
                          ? { ...x, children: move(x.children, from, to) }
                          : x,
                      ),
                    )
                  }
                >
                  {link.children.map((child) => (
                    <ListRow
                      key={child.id}
                      id={child.id}
                      removeLabel={t("removeChild")}
                      onRemove={() =>
                        setLinks((l) =>
                          l.map((x) =>
                            x.id === link.id
                              ? {
                                  ...x,
                                  children: x.children.filter(
                                    (c) => c.id !== child.id,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                      data-nav-child={child.id}
                    >
                      <LinkEditor
                        link={child}
                        collections={collections}
                        showIcon={false}
                        onChange={(next) =>
                          setLinks((l) =>
                            l.map((x) =>
                              x.id === link.id
                                ? {
                                    ...x,
                                    children: x.children.map((c) =>
                                      c.id === child.id ? next : c,
                                    ),
                                  }
                                : x,
                            ),
                          )
                        }
                      />
                    </ListRow>
                  ))}
                </SortableList>
              </NestedList>
            </ListRow>
          ))}
        </SortableList>
        <AddButton
          disabled={links.length >= MAX_NAV_LINKS}
          onClick={() => setLinks((l) => [...l, newNavLink()])}
        >
          {t("addLink")}
        </AddButton>
        {links.length >= MAX_NAV_LINKS ? (
          <p className="text-xs text-muted-foreground">
            {t("maxReached", { max: MAX_NAV_LINKS })}
          </p>
        ) : null}
      </div>
    </SectionShell>
  );
}
