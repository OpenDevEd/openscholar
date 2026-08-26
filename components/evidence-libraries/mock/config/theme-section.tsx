"use client";

import { ChevronDown, ChevronRight, Palette } from "lucide-react";
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
  COLOUR_PRESETS,
  FONT_FAMILIES,
  type FontFamily,
  type LibraryConfig,
} from "@/lib/evidence-libraries/mock/config";
import { Field } from "../section-card";
import { ChoiceCards, ColourField, FieldGroup, UploadField } from "./fields";
import { SectionShell, type SectionProps } from "./section-shell";

type Theme = LibraryConfig["theme"];
const MODES: Theme["defaultMode"][] = ["light", "dark", "system"];
const ADVANCED_COLOURS: ("backgroundDark" | "backgroundLight" | "cardDark" | "cardLight")[] = [
  "backgroundDark",
  "backgroundLight",
  "cardDark",
  "cardLight",
];

const fontStack = (font: FontFamily) => `"${font}", sans-serif`;

export function ThemeSection({ library, patch }: SectionProps) {
  const t = useTranslations("evidenceLibraryMock.config.theme");
  const theme = library.draft.theme;
  const [advancedOpen, setAdvancedOpen] = useState(false);

  function set<K extends keyof Theme>(key: K, value: Theme[K]) {
    patch((d) => {
      d.theme[key] = value;
      return d;
    });
  }

  return (
    <SectionShell sectionKey="theme" icon={Palette} description={t("description")} library={library}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex min-h-5 items-center"><Label className="font-normal">{t("layoutLabel")}</Label></div>
          <ChoiceCards
              value={theme.layout}
              onChange={(layout) => patch((d) => { d.theme.layout = layout; return d; })}
              columns={1}
              options={(["small", "wide"] as const).map((layout) => ({
                value: layout,
                label: t(`layout.${layout}`),
                hint: t(`layoutHint.${layout}`),
                preview: <NavbarPreview layout={layout} />,
              }))}
            />
        </div>

        <Field label={t("modeLabel")} hint={t("modeHint")}>
          {(id) => (
            <Select value={theme.defaultMode} onValueChange={(v) => set("defaultMode", v as Theme["defaultMode"])}>
              <SelectTrigger id={id} className="w-full bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {t(`mode.${mode}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
      </div>

      <FieldGroup title={t("fontsHeading")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FontSelect label={t("headingFontLabel")} value={theme.headingFont} onChange={(v) => set("headingFont", v)} />
          <FontSelect label={t("bodyFontLabel")} value={theme.bodyFont} onChange={(v) => set("bodyFont", v)} />
        </div>
        <div className="rounded-lg border border-border/50 bg-background p-4" data-font-sample>
          <p className="text-lg font-semibold" style={{ fontFamily: fontStack(theme.headingFont) }}>
            {t("sampleHeading", { name: library.draft.identity.name || library.name })}
          </p>
          <p className="mt-1 text-sm text-muted-foreground" style={{ fontFamily: fontStack(theme.bodyFont) }}>
            {t("sampleBody")}
          </p>
        </div>
      </FieldGroup>

      <FieldGroup title={t("logosHeading")}>
        <div className="grid gap-4 lg:grid-cols-2">
          <UploadField
            label={t("logoDarkLabel")}
            kind="image"
            required
            slot={`${library.id}:logoDark`}
            value={theme.logoDark}
            onChange={(file) => set("logoDark", file)}
          />
          <UploadField
            label={t("logoLightLabel")}
            kind="image"
            optional
            slot={`${library.id}:logoLight`}
            value={theme.logoLight}
            onChange={(file) => set("logoLight", file)}
          />
          <UploadField
            label={t("faviconLabel")}
            hint={t("faviconHint")}
            kind="image"
            required
            slot={`${library.id}:favicon`}
            value={theme.favicon}
            onChange={(file) => set("favicon", file)}
          />
        </div>
      </FieldGroup>

      <FieldGroup title={t("coloursHeading")}>
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{t("presetsLabel")}</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("presetsLabel")}>
            {COLOUR_PRESETS.map((p) => {
              const active =
                p.accent === theme.accent && p.secondary === theme.secondary && p.link === theme.link;
              return (
                <Button
                  key={p.name}
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={active}
                  data-preset={p.name}
                  className="gap-2"
                  onClick={() =>
                    patch((d) => {
                      d.theme.accent = p.accent;
                      d.theme.secondary = p.secondary;
                      d.theme.link = p.link;
                      return d;
                    })
                  }
                >
                  <span className="flex gap-0.5">
                    {[p.accent, p.secondary, p.link].map((c, i) => (
                      <span
                        key={i}
                        className="size-3 rounded-sm border border-border/40"
                        style={{ background: c }}
                      />
                    ))}
                  </span>
                  {p.name}
                </Button>
              );
            })}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <ColourField
            label={t("accentLabel")}
            hint={t("accentHint")}
            value={theme.accent}
            onChange={(v) => set("accent", v)}
          />
          <ColourField
            label={t("secondaryLabel")}
            hint={t("secondaryHint")}
            value={theme.secondary}
            onChange={(v) => set("secondary", v)}
          />
          <ColourField
            label={t("linkLabel")}
            hint={t("linkHint")}
            value={theme.link}
            contrastAgainst={[theme.backgroundDark, theme.backgroundLight]}
            onChange={(v) => set("link", v)}
          />
        </div>
      </FieldGroup>

      <div className="space-y-3 border-t border-border/50 pt-5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 h-7 text-xs font-medium text-muted-foreground hover:text-foreground"
          aria-expanded={advancedOpen}
          aria-controls="theme-advanced"
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          {advancedOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {t("advanced")}
        </Button>
        {advancedOpen ? (
          <div id="theme-advanced" className="grid gap-4 rounded-lg bg-muted/30 p-3 sm:grid-cols-2">
            {ADVANCED_COLOURS.map((key) => (
              <ColourField
                key={key}
                label={t(`advancedColour.${key}`)}
                value={theme[key]}
                onChange={(v) => set(key, v)}
              />
            ))}
          </div>
        ) : null}
      </div>
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
