"use client";

import { ChevronDown, ChevronRight, Database } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { cn } from "@/lib/utils";
import { SOURCE_STYLES, type SourceStyle, SourceCardByStyle } from "./source-card-styles";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  newId,
  TAG_RULE_KEYS,
  type TagRuleKey,
  type ZoteroSource,
} from "@/lib/evidence-libraries/mock/config";
import { AddButton, ChipInput, EmptyList, SubHeading, ToggleRow } from "./fields";
import { SectionShell, type SectionProps } from "./section-shell";

const TAG_RULE_COPY: Record<TagRuleKey, { label: string; hint: string }> = {
  hidden: { label: "hiddenLabel", hint: "hiddenHint" },
  internal: { label: "internalLabel", hint: "internalHint" },
  comingSoon: { label: "comingSoonLabel", hint: "comingSoonHint" },
  description: { label: "descriptionLabel", hint: "descriptionHint" },
  redirects: { label: "redirectsLabel", hint: "redirectsHint" },
  publish: { label: "publishLabel", hint: "publishHint" },
};

export function SourcesSection({ library, patch }: SectionProps) {
  const t = useTranslations("evidenceLibraryMock.config.sources");
  const sources = library.draft.sources;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [style, setStyle] = useQueryState(
    "sourceStyle",
    parseAsStringLiteral(SOURCE_STYLES).withDefault("ledger"),
  );

  function updateSource(id: string, update: (row: ZoteroSource) => void) {
    patch((d) => {
      const row = d.sources.zotero.find((s) => s.id === id);
      if (row) update(row);
      return d;
    });
  }

  return (
    <SectionShell sectionKey="sources" icon={Database} description={t("description")} library={library}>
      <div className="space-y-3">
        <SubHeading
          action={
            <AddButton
              onClick={() =>
                patch((d) => {
                  d.sources.zotero.push({
                    id: newId("src"),
                    label: "",
                    auth: "zotero",
                    groupId: "",
                    apiKey: "",
                    enabled: true,
                    writeback: false,
                    lastSync: null,
                    records: 0,
                  });
                  return d;
                })
              }
            >
              {t("addGroup")}
            </AddButton>
          }
        >
          {t("groupsHeading")}
        </SubHeading>
        {/* Mock-only: compare card styles */}
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground" data-style-switch>
          <span className="mr-1">Style:</span>
          {SOURCE_STYLES.map((key, i) => (
            <button
              key={key}
              type="button"
              aria-pressed={style === key}
              onClick={() => void setStyle(key)}
              className={cn(
                "rounded-full border px-2 py-0.5 capitalize",
                style === key
                  ? "border-primary/40 bg-primary/10 font-medium text-primary"
                  : "border-border/50 hover:text-foreground",
              )}
            >
              {i + 1} · {key}
            </button>
          ))}
        </div>
        {sources.zotero.length === 0 ? (
          <EmptyList>{t("noGroups")}</EmptyList>
        ) : (
          <div className="space-y-3">
            {sources.zotero.map((source) => (
              <SourceCardByStyle
                key={source.id}
                style={style as SourceStyle}
                libraryId={library.id}
                source={source}
                onChange={(update) => updateSource(source.id, update)}
                onRemove={() => setRemoveId(source.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
          aria-expanded={advancedOpen}
          aria-controls={`${library.id}-sources-advanced`}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          {advancedOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {t("advanced")}
        </Button>
        {advancedOpen ? (
          <div
            id={`${library.id}-sources-advanced`}
            className="space-y-4 rounded-lg border border-border/50 bg-muted/30 p-3"
          >
            <div className="space-y-0.5">
              <p className="text-sm font-medium">{t("tagRulesHeading")}</p>
              <p className="text-xs text-muted-foreground">{t("tagRulesIntro")}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {TAG_RULE_KEYS.map((key) => (
                <ChipInput
                  key={key}
                  label={t(TAG_RULE_COPY[key].label as "hiddenLabel")}
                  hint={t(TAG_RULE_COPY[key].hint as "hiddenHint")}
                  values={sources.tagRules[key]}
                  placeholder={t("tagPlaceholder")}
                  error={key === "publish" && sources.tagRules.publish.length === 0 ? t("publishError") : null}
                  onChange={(values) =>
                    patch((d) => {
                      d.sources.tagRules[key] = values;
                      return d;
                    })
                  }
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <AlertDialog open={removeId !== null} onOpenChange={(open) => !open && setRemoveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("removeBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("removeCancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const id = removeId;
                setRemoveId(null);
                if (!id) return;
                patch((d) => {
                  d.sources.zotero = d.sources.zotero.filter((s) => s.id !== id);
                  return d;
                });
              }}
            >
              {t("removeConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionShell>
  );
}

