"use client";

import { Github, Linkedin, Youtube } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { HTTPS_URL, newLink } from "@/lib/evidence-libraries/configuration/links";
import {
  collectionOptions,
  type FooterSectionDraft,
  type FunderDraft,
  newId,
  SCHEMA_LIMITS,
  SOCIAL_PROVIDERS,
  type SocialProvider,
} from "@/lib/evidence-libraries/configuration/rules";
import { Field } from "../section-card";
import {
  AddButton,
  EmptyList,
  FieldGroup,
  ListRow,
  move,
  NestedList,
  SortableList,
  ToggleRow,
  UploadField,
} from "../fields";
import { SectionShell, type SectionProps } from "../section-shell";
import { BlueskyIcon, XIcon } from "../social-icons";
import { LinkEditor } from "./link-editor";
import { FooterIcon } from "@/components/section-icons";

const LIMITS = SCHEMA_LIMITS.footer;

const SOCIAL_ICONS: Record<SocialProvider, React.ComponentType<{ className?: string }>> = {
  github: Github,
  twitter: XIcon,
  linkedin: Linkedin,
  youtube: Youtube,
  bluesky: BlueskyIcon,
};

export function FooterSection({ draft, saved, patch, reset }: SectionProps) {
  const t = useTranslations("evidenceLibraryConfiguration.footer");
  const tf = useTranslations("evidenceLibraryConfiguration.fields");
  const footer = draft.footer;
  const collections = collectionOptions(draft);

  const setSections = (update: (sections: FooterSectionDraft[]) => FooterSectionDraft[]) =>
    patch((d) => {
      d.footer.sections = update(d.footer.sections);
      return d;
    });
  const updateSection = (
    sectionId: string,
    update: (section: FooterSectionDraft) => FooterSectionDraft,
  ) => setSections((all) => all.map((s) => (s.id === sectionId ? update(s) : s)));
  const setFunders = (update: (funders: FunderDraft[]) => FunderDraft[]) =>
    patch((d) => {
      d.footer.funders = update(d.footer.funders);
      return d;
    });
  const updateFunder = (funderId: string, update: Partial<FunderDraft>) =>
    setFunders((all) => all.map((f) => (f.id === funderId ? { ...f, ...update } : f)));

  return (
    <SectionShell
      sectionKey="footer"
      icon={FooterIcon}
      description={t("description")}
      draft={draft}
      saved={saved}
      reset={reset}
    >
      <FieldGroup
        title={t("sectionsHeading")}
        action={
          <AddButton
            disabled={footer.sections.length >= LIMITS.sections}
            onClick={() =>
              setSections((all) => [...all, { id: newId("fs"), title: "", links: [] }])
            }
          >
            {t("addSection")}
          </AddButton>
        }
      >
        {footer.sections.length === 0 ? (
          <EmptyList>{t("sectionsEmpty")}</EmptyList>
        ) : (
          <SortableList
            ids={footer.sections.map((s) => s.id)}
            onMove={(from, to) => setSections((all) => move(all, from, to))}
          >
            {footer.sections.map((section) => (
              <ListRow
                key={section.id}
                id={section.id}
                removeLabel={t("removeSection")}
                onRemove={() => setSections((all) => all.filter((s) => s.id !== section.id))}
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
                      maxLength={LIMITS.sectionTitle}
                      value={section.title}
                      aria-invalid={invalid || undefined}
                      placeholder={t("sectionTitlePlaceholder")}
                      onChange={(e) =>
                        updateSection(section.id, (s) => ({ ...s, title: e.target.value }))
                      }
                    />
                  )}
                </Field>
                <NestedList
                  label={t("sectionLinks")}
                  addLabel={t("addSectionLink")}
                  disabled={section.links.length >= LIMITS.sectionLinks}
                  onAdd={() =>
                    updateSection(section.id, (s) => ({
                      ...s,
                      links: [...s.links, newLink(newId("fl"))],
                    }))
                  }
                >
                  <SortableList
                    ids={section.links.map((link) => link.id)}
                    onMove={(from, to) =>
                      updateSection(section.id, (s) => ({ ...s, links: move(s.links, from, to) }))
                    }
                  >
                    {section.links.map((link) => (
                      <ListRow
                        key={link.id}
                        id={link.id}
                        removeLabel={t("removeSectionLink")}
                        onRemove={() =>
                          updateSection(section.id, (s) => ({
                            ...s,
                            links: s.links.filter((l) => l.id !== link.id),
                          }))
                        }
                      >
                        <LinkEditor
                          link={link}
                          collections={collections}
                          showIcon={false}
                          onChange={(next) =>
                            updateSection(section.id, (s) => ({
                              ...s,
                              links: s.links.map((l) => (l.id === link.id ? next : l)),
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
      </FieldGroup>

      <FieldGroup title={t("socialHeading")}>
        <div className="grid gap-3 sm:grid-cols-2">
          {SOCIAL_PROVIDERS.map((provider) => {
            const Icon = SOCIAL_ICONS[provider];
            const value = footer.social[provider] ?? "";
            const error = value && !HTTPS_URL.test(value) ? t("socialError") : null;
            return (
              <Field key={provider} label={t(`social.${provider}`)} error={error}>
                {(id, invalid) => (
                  <div className="relative">
                    <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id={id}
                      className="bg-background pl-9 font-mono text-sm"
                      value={value}
                      inputMode="url"
                      placeholder="https://"
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

      <FieldGroup
        title={t("fundersHeading")}
        action={
          <AddButton
            disabled={footer.funders.length >= LIMITS.funders}
            onClick={() =>
              setFunders((all) => [...all, { id: newId("fu"), name: "", logoUrl: "", href: "" }])
            }
          >
            {t("addFunder")}
          </AddButton>
        }
      >
        {footer.funders.length === 0 ? (
          <EmptyList>{t("fundersEmpty")}</EmptyList>
        ) : (
          <SortableList
            ids={footer.funders.map((f) => f.id)}
            onMove={(from, to) => setFunders((all) => move(all, from, to))}
          >
            {footer.funders.map((funder) => (
              <ListRow
                key={funder.id}
                id={funder.id}
                removeLabel={t("removeFunder")}
                onRemove={() => setFunders((all) => all.filter((f) => f.id !== funder.id))}
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
                        maxLength={LIMITS.funderName}
                        value={funder.name}
                        aria-invalid={invalid || undefined}
                        onChange={(e) => updateFunder(funder.id, { name: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field
                    label={t("funderUrl")}
                    suffix={tf("optional")}
                    error={funder.href && !HTTPS_URL.test(funder.href) ? t("socialError") : null}
                  >
                    {(id, invalid) => (
                      <Input
                        id={id}
                        className="bg-background font-mono text-sm"
                        value={funder.href}
                        inputMode="url"
                        placeholder="https://"
                        aria-invalid={invalid || undefined}
                        onChange={(e) => updateFunder(funder.id, { href: e.target.value })}
                      />
                    )}
                  </Field>
                </div>
                <UploadField
                  label={t("funderLogo")}
                  kind="image"
                  optional
                  value={funder.logoUrl || null}
                  onChange={(url) => updateFunder(funder.id, { logoUrl: url ?? "" })}
                />
              </ListRow>
            ))}
          </SortableList>
        )}
      </FieldGroup>

      <FieldGroup title={t("textHeading")}>
        <Field
          label={t("disclaimer")}
          hint={t("disclaimerHint")}
          suffix={tf("optional")}
          counter={`${footer.disclaimer.length} / ${LIMITS.disclaimer}`}
        >
          {(id) => (
            <Textarea
              id={id}
              className="bg-background"
              rows={4}
              maxLength={LIMITS.disclaimer}
              value={footer.disclaimer}
              onChange={(e) =>
                patch((d) => {
                  d.footer.disclaimer = e.target.value;
                  return d;
                })
              }
            />
          )}
        </Field>
        <Field
          label={t("attribution")}
          hint={t("attributionHint")}
          suffix={tf("optional")}
          counter={`${footer.attribution.length} / ${LIMITS.attribution}`}
        >
          {(id) => (
            <Input
              id={id}
              className="bg-background"
              maxLength={LIMITS.attribution}
              value={footer.attribution}
              onChange={(e) =>
                patch((d) => {
                  d.footer.attribution = e.target.value;
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
