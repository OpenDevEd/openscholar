"use client";

import {
  Github,
  Linkedin,
  PanelBottom,
  Youtube,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  type FooterSection as FooterLinkSection,
  type Funder,
  newId,
  SOCIAL_PROVIDERS,
  type SocialProvider,
} from "@/lib/evidence-libraries/mock/config";
import { Field } from "../section-card";
import {
  AddButton,
  EmptyList,
  ListRow,
  move,
  FieldGroup,
  Panel,
  SortableList,
  ToggleRow,
  UploadField,
} from "./fields";
import { LinkEditor, MAX_NAV_LINKS, newNavLink } from "./navigation-section";
import { BlueskyIcon, XIcon } from "../social-icons";
import { SectionShell, type SectionProps } from "./section-shell";

const MAX_SECTIONS = 6;
const MAX_FUNDERS = 20;
const DISCLAIMER_MAX = 2000;
const ATTRIBUTION_MAX = 500;

const SOCIAL_ICONS: Record<SocialProvider, React.ComponentType<{ className?: string }>> = {
  github: Github,
  twitter: XIcon,
  linkedin: Linkedin,
  youtube: Youtube,
  bluesky: BlueskyIcon,
};

const isHttps = (v: string) => /^https:\/\/\S+$/.test(v);

export function FooterSection({ library, patch }: SectionProps) {
  const t = useTranslations("evidenceLibraryMock.config.footer");
  const footer = library.draft.footer;
  const collections = library.draft.collections;

  const setSections = (
    update: (s: FooterLinkSection[]) => FooterLinkSection[],
  ) =>
    patch((d) => {
      d.footer.sections = update(d.footer.sections);
      return d;
    });
  const setFunders = (update: (f: Funder[]) => Funder[]) =>
    patch((d) => {
      d.footer.funders = update(d.footer.funders);
      return d;
    });

  return (
    <SectionShell
      sectionKey="footer"
      icon={PanelBottom}
      description={t("description")}
      library={library}
    >
      {/* Link sections */}
      <FieldGroup
        title={t("sectionsHeading", {
          count: footer.sections.length,
          max: MAX_SECTIONS,
        })}
        action={
          <AddButton
            disabled={footer.sections.length >= MAX_SECTIONS}
            onClick={() =>
              setSections((s) => [
                ...s,
                { id: newId("fs"), title: "", links: [] },
              ])
            }
          >
            {t("addSection")}
          </AddButton>
        }
      >
        {footer.sections.length === 0 ? (
          <EmptyList>{t("sectionsEmpty")}</EmptyList>
        ) : null}
        <SortableList
          ids={footer.sections.map((s) => s.id)}
          onMove={(from, to) => setSections((s) => move(s, from, to))}
        >
          {footer.sections.map((section) => (
            <ListRow
              key={section.id}
              id={section.id}
              removeLabel={t("removeSection")}
              onRemove={() =>
                setSections((s) => s.filter((x) => x.id !== section.id))
              }
              data-footer-section={section.id}
            >
              <Field
                label={t("sectionTitle")}
                error={!section.title.trim() ? t("sectionTitleError") : null}
              >
                {(id, invalid) => (
                  <Input
                    id={id}
                    className="bg-background"
                    value={section.title}
                    aria-invalid={invalid || undefined}
                    placeholder={t("sectionTitlePlaceholder")}
                    onChange={(e) =>
                      setSections((s) =>
                        s.map((x) =>
                          x.id === section.id
                            ? { ...x, title: e.target.value }
                            : x,
                        ),
                      )
                    }
                  />
                )}
              </Field>
              <Panel tone="muted" className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t("sectionLinks", {
                      count: section.links.length,
                      max: MAX_NAV_LINKS,
                    })}
                  </p>
                  <AddButton
                    disabled={section.links.length >= MAX_NAV_LINKS}
                    onClick={() =>
                      setSections((s) =>
                        s.map((x) =>
                          x.id === section.id
                            ? { ...x, links: [...x.links, newNavLink()] }
                            : x,
                        ),
                      )
                    }
                  >
                    {t("addSectionLink")}
                  </AddButton>
                </div>
                {section.links.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("sectionLinksEmpty")}
                  </p>
                ) : null}
                <SortableList
                  ids={section.links.map((l) => l.id)}
                  onMove={(from, to) =>
                    setSections((s) =>
                      s.map((x) =>
                        x.id === section.id
                          ? { ...x, links: move(x.links, from, to) }
                          : x,
                      ),
                    )
                  }
                >
                  {section.links.map((link) => (
                    <ListRow
                      key={link.id}
                      id={link.id}
                      removeLabel={t("removeSectionLink")}
                      onRemove={() =>
                        setSections((s) =>
                          s.map((x) =>
                            x.id === section.id
                              ? {
                                  ...x,
                                  links: x.links.filter(
                                    (l) => l.id !== link.id,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                    >
                      <LinkEditor
                        link={link}
                        collections={collections}
                        showIcon={false}
                        onChange={(next) =>
                          setSections((s) =>
                            s.map((x) =>
                              x.id === section.id
                                ? {
                                    ...x,
                                    links: x.links.map((l) =>
                                      l.id === link.id ? next : l,
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
              </Panel>
            </ListRow>
          ))}
        </SortableList>
      </FieldGroup>

      {/* Social links */}
      <FieldGroup title={t("socialHeading")}>
        <div className="grid gap-3 sm:grid-cols-2">
          {SOCIAL_PROVIDERS.map((provider) => {
            const Icon = SOCIAL_ICONS[provider];
            const value = footer.social[provider] ?? "";
            const error = value && !isHttps(value) ? t("socialError") : null;
            return (
              <Field
                key={provider}
                label={t(`social.${provider}`)}
                error={error}
              >
                {(id, invalid) => (
                  <div className="relative">
                    <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id={id}
                      className="bg-background pl-9 font-mono text-sm"
                      value={value}
                      inputMode="url"
                      placeholder="https://…"
                      aria-invalid={invalid || undefined}
                      onChange={(e) =>
                        patch((d) => {
                          const next = e.target.value;
                          if (next) d.footer.social[provider] = next;
                          else delete d.footer.social[provider];
                          return d;
                        })
                      }
                    />
                  </div>
                )}
              </Field>
            );
          })}
        </div>
      </FieldGroup>

      {/* Funders */}
      <FieldGroup
        title={t("fundersHeading", {
          count: footer.funders.length,
          max: MAX_FUNDERS,
        })}
        action={
          <AddButton
            disabled={footer.funders.length >= MAX_FUNDERS}
            onClick={() =>
              setFunders((f) => [
                ...f,
                { id: newId("fund"), name: "", logo: null, url: "" },
              ])
            }
          >
            {t("addFunder")}
          </AddButton>
        }
      >
        {footer.funders.length === 0 ? (
          <EmptyList>{t("fundersEmpty")}</EmptyList>
        ) : null}
        <SortableList
          ids={footer.funders.map((f) => f.id)}
          onMove={(from, to) => setFunders((f) => move(f, from, to))}
        >
          {footer.funders.map((funder) => (
            <ListRow
              key={funder.id}
              id={funder.id}
              removeLabel={t("removeFunder")}
              onRemove={() =>
                setFunders((f) => f.filter((x) => x.id !== funder.id))
              }
              data-funder={funder.id}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={t("funderName")}
                  error={!funder.name.trim() ? t("funderNameError") : null}
                >
                  {(id, invalid) => (
                    <Input
                      id={id}
                      className="bg-background"
                      value={funder.name}
                      aria-invalid={invalid || undefined}
                      onChange={(e) =>
                        setFunders((f) =>
                          f.map((x) =>
                            x.id === funder.id
                              ? { ...x, name: e.target.value }
                              : x,
                          ),
                        )
                      }
                    />
                  )}
                </Field>
                <Field
                  label={t("funderUrl")}
                  suffix={t("optional")}
                  error={
                    funder.url && !isHttps(funder.url) ? t("socialError") : null
                  }
                >
                  {(id, invalid) => (
                    <Input
                      id={id}
                      className="bg-background font-mono text-sm"
                      value={funder.url}
                      inputMode="url"
                      placeholder="https://…"
                      aria-invalid={invalid || undefined}
                      onChange={(e) =>
                        setFunders((f) =>
                          f.map((x) =>
                            x.id === funder.id
                              ? { ...x, url: e.target.value }
                              : x,
                          ),
                        )
                      }
                    />
                  )}
                </Field>
              </div>
              <UploadField
                label={t("funderLogo")}
                kind="image"
                optional
                slot={`${library.id}:funder:${funder.id}`}
                value={funder.logo}
                onChange={(logo) =>
                  setFunders((f) =>
                    f.map((x) => (x.id === funder.id ? { ...x, logo } : x)),
                  )
                }
              />
            </ListRow>
          ))}
        </SortableList>
      </FieldGroup>

      {/* Text */}
      <FieldGroup title={t("textHeading")}>
        <Field
          label={t("disclaimer")}
          hint={t("disclaimerHint")}
          suffix={t("optional")}
          counter={`${footer.disclaimer.length} / ${DISCLAIMER_MAX}`}
        >
          {(id) => (
            <Textarea
              id={id}
              className="bg-background"
              rows={4}
              maxLength={DISCLAIMER_MAX}
              value={footer.disclaimer}
              onChange={(e) =>
                patch((d) => {
                  d.footer.disclaimer = e.target.value.slice(0, DISCLAIMER_MAX);
                  return d;
                })
              }
            />
          )}
        </Field>
        <Field
          label={t("attribution")}
          hint={t("attributionHint")}
          suffix={t("optional")}
          counter={`${footer.attribution.length} / ${ATTRIBUTION_MAX}`}
        >
          {(id) => (
            <Input
              id={id}
              className="bg-background"
              maxLength={ATTRIBUTION_MAX}
              value={footer.attribution}
              onChange={(e) =>
                patch((d) => {
                  d.footer.attribution = e.target.value.slice(
                    0,
                    ATTRIBUTION_MAX,
                  );
                  return d;
                })
              }
            />
          )}
        </Field>
      </FieldGroup>

      <ToggleRow
        label={t("poweredBy")}
        hint={t("poweredByHint")}
        checked={footer.poweredBy}
        locked
        disabledReason={t("poweredByLocked")}
        onChange={() => undefined}
        data-powered-by
      />
    </SectionShell>
  );
}
