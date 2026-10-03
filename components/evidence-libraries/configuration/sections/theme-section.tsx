"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type ColourKey,
  FONT_FAMILIES,
  type FontFamily,
  THEME_LAYOUTS,
  THEME_MODES,
  type ThemeDraft,
} from "@/lib/evidence-libraries/configuration/rules";
import { COLOUR_PRESETS } from "../colours";
import { Field } from "../section-card";
import { ChoiceCards, ColourField, FieldGroup, UploadField } from "../fields";
import { SectionShell, type SectionProps } from "../section-shell";
import { Disclosure } from "../disclosure-button";
import { PaletteIcon } from "@/components/section-icons";

const ADVANCED_COLOURS = [
  "backgroundDark",
  "backgroundLight",
  "cardDark",
  "cardLight",
] as const satisfies readonly ColourKey[];

const fontStack = (font: FontFamily) => `"${font}", sans-serif`;

export function ThemeSection({ draft, saved, patch, reset }: SectionProps) {
  const t = useTranslations("evidenceLibraryConfiguration.theme");
  const theme = draft.theme;
  const assets = draft.identity.assets;
  const [advancedOpen, setAdvancedOpen] = useState(false);

  function set<K extends keyof ThemeDraft>(key: K, value: ThemeDraft[K]) {
    patch((d) => {
      d.theme[key] = value;
      return d;
    });
  }

  function setColour(key: ColourKey, value: string) {
    patch((d) => {
      d.theme.colors[key] = value;
      return d;
    });
  }

  function setLogo(
    key: "logoLight" | "logoDark" | "favicon" | "faviconDark",
    url: string | null,
  ) {
    patch((d) => {
      d.identity.assets[key] = url ?? "";
      return d;
    });
  }

  return (
    <SectionShell
      sectionKey="theme"
      icon={PaletteIcon}
      description={t("description")}
      draft={draft}
      saved={saved}
      reset={reset}
    >
      <div className="space-y-1.5">
        <div className="flex min-h-5 items-center">
          <Label className="font-normal">{t("layoutLabel")}</Label>
        </div>
        <ChoiceCards
          value={theme.layout}
          onChange={(layout) => set("layout", layout)}
          columns={2}
          ariaLabel={t("layoutLabel")}
          options={THEME_LAYOUTS.map((layout) => ({
            value: layout,
            label: t(`layout.${layout}`),
            hint: t(`layoutHint.${layout}`),
            preview: <NavbarPreview layout={layout} />,
          }))}
        />
      </div>

      <Field label={t("modeLabel")} hint={t("modeHint")} className="max-w-sm">
        {(id) => (
          <Select
            value={theme.defaultMode}
            onValueChange={(v) => set("defaultMode", v as ThemeDraft["defaultMode"])}
          >
            <SelectTrigger id={id} className="w-full bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {THEME_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {t(`mode.${mode}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>

      <FieldGroup title={t("fontsHeading")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FontSelect
            label={t("headingFontLabel")}
            value={theme.fonts.heading}
            onChange={(heading) => set("fonts", { ...theme.fonts, heading })}
          />
          <FontSelect
            label={t("bodyFontLabel")}
            value={theme.fonts.body}
            onChange={(body) => set("fonts", { ...theme.fonts, body })}
          />
        </div>
        <div className="rounded-lg border border-border/50 bg-background p-4" data-font-sample>
          <p className="text-lg font-semibold" style={{ fontFamily: fontStack(theme.fonts.heading) }}>
            {draft.identity.name || t("sampleHeading")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground" style={{ fontFamily: fontStack(theme.fonts.body) }}>
            {t("sampleBody")}
          </p>
        </div>
      </FieldGroup>

      <FieldGroup title={t("logosHeading")}>
        <div className="grid gap-4 lg:grid-cols-2">
          <UploadField
            label={t("logoLightLabel")}
            hint={t("logoLightHint")}
            kind="image"
            value={assets.logoLight || null}
            onChange={(url) => setLogo("logoLight", url)}
          />
          <UploadField
            label={t("logoDarkLabel")}
            hint={t("logoDarkHint")}
            kind="image"
            value={assets.logoDark || null}
            onChange={(url) => setLogo("logoDark", url)}
            optional
          />
          <UploadField
            label={t("faviconLabel")}
            hint={t("faviconHint")}
            kind="icon"
            value={assets.favicon || null}
            onChange={(url) => setLogo("favicon", url)}
          />
          <UploadField
            label={t("faviconDarkLabel")}
            hint={t("faviconDarkHint")}
            kind="icon"
            value={assets.faviconDark || null}
            onChange={(url) => setLogo("faviconDark", url)}
            optional
          />
        </div>
      </FieldGroup>

      <FieldGroup title={t("coloursHeading")}>
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{t("presetsLabel")}</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("presetsLabel")}>
            {COLOUR_PRESETS.map((p) => {
              const active = Object.entries(p.colors).every(
                ([key, value]) => value.toLowerCase() === theme.colors[key as ColourKey].toLowerCase(),
              );
              return (
                <Button
                  key={p.key}
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={active}
                  data-preset={p.key}
                  className="gap-2"
                  onClick={() =>
                    patch((d) => {
                      d.theme.colors = { ...p.colors };
                      return d;
                    })
                  }
                >
                  <span className="flex gap-0.5">
                    {[p.colors.accent, p.colors.tertiary, p.colors.link].map((c) => (
                      <span
                        key={c}
                        className="size-3 rounded-sm border border-border/40"
                        style={{ background: c }}
                      />
                    ))}
                  </span>
                  {t(`presets.${p.key}`)}
                </Button>
              );
            })}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <ColourField
            label={t("accentLabel")}
            hint={t("accentHint")}
            value={theme.colors.accent}
            onChange={(v) => setColour("accent", v)}
          />
          <ColourField
            label={t("secondaryLabel")}
            hint={t("secondaryHint")}
            value={theme.colors.tertiary}
            onChange={(v) => setColour("tertiary", v)}
          />
          <ColourField
            label={t("linkLabel")}
            hint={t("linkHint")}
            value={theme.colors.link}
            contrastAgainst={[theme.colors.backgroundDark, theme.colors.backgroundLight]}
            onChange={(v) => setColour("link", v)}
          />
        </div>
      </FieldGroup>

      <Disclosure
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        label={t("advanced")}
        className="border-t border-border/50 pt-5"
      >
        <div className="pt-3">
          <div className="grid gap-4 rounded-lg bg-muted/30 p-3 sm:grid-cols-2">
            {ADVANCED_COLOURS.map((key) => (
              <ColourField
                key={key}
                label={t(`advancedColour.${key}`)}
                value={theme.colors[key]}
                onChange={(v) => setColour(key, v)}
              />
            ))}
          </div>
        </div>
      </Disclosure>
    </SectionShell>
  );
}

function FontSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: FontFamily;
  onChange: (value: FontFamily) => void;
}) {
  return (
    <Field label={label}>
      {(id) => (
        <Select value={value} onValueChange={(v) => onChange(v as FontFamily)}>
          <SelectTrigger id={id} className="w-full bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FONT_FAMILIES.map((font) => (
              <SelectItem key={font} value={font}>
                <span style={{ fontFamily: fontStack(font) }}>{font}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}

/**
 * Just the navbar, drawn in the app's own tokens: "small" floats inset from
 * the page edges with rounded corners; "wide" runs edge to edge.
 */
function NavbarPreview({ layout }: { layout: "small" | "wide" }) {
  return (
    <span
      aria-hidden
      data-layout-preview={layout}
      className="block h-16 w-full overflow-hidden rounded-md border border-border/50 bg-muted/40"
    >
      <span
        className={
          layout === "small"
            ? "mx-3 mt-2 flex h-6 items-center gap-2 rounded-md border border-border/60 bg-background px-2 shadow-xs"
            : "flex h-7 items-center gap-2 border-b border-border/60 bg-background px-3"
        }
      >
        <span className="h-2 w-10 rounded-sm bg-foreground/70" />
        <span className="ml-auto flex items-center gap-1.5">
          <span className="h-1.5 w-6 rounded-sm bg-muted-foreground/50" />
          <span className="h-1.5 w-6 rounded-sm bg-muted-foreground/50" />
          <span className="h-1.5 w-6 rounded-sm bg-primary/80" />
          <span className="h-1.5 w-6 rounded-sm bg-muted-foreground/50" />
        </span>
      </span>
    </span>
  );
}
