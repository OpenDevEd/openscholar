"use client";

import { useTranslations } from "next-intl";
import { Documents, Tag } from "@/components/icons";
import { Segmented } from "@/components/settings/parts";
import { Collapsible } from "@/components/ui/collapsible";
import { ChipInput } from "../fields";
import { DisclosureContent } from "../disclosure-button";
import { SourceSwitch } from "./source-row";
import { DEFAULT_TAG_RULES, tagRuleIssue, type TagRules } from "./tag-rules";

/** Which of a Zotero group's PDFs the library publishes: those with a publish tag, or all of them. */
export type PdfPublishing = "tagged" | "every";

/**
 * A Zotero row's PDFs switch and the band it opens: whether a PDF needs a publish tag, and the tags that publish one.
 * The tags are the library's, shared by every Zotero group, and notes and links need one of them whatever the choice.
 */
export function sourcePdfs({ downloadPdfs, onDownloadPdfsChange, publishing, onPublishingChange, tags, onTagsChange }: {
  downloadPdfs: boolean;
  onDownloadPdfsChange: (downloadPdfs: boolean) => void;
  publishing: PdfPublishing;
  onPublishingChange: (publishing: PdfPublishing) => void;
  tags: TagRules;
  onTagsChange: (tags: TagRules) => void;
}) {
  return {
    control: <PdfSwitch checked={downloadPdfs} onCheckedChange={onDownloadPdfsChange} />,
    band: (
      <Collapsible open={downloadPdfs}>
        <DisclosureContent>
          <PdfBand publishing={publishing} onPublishingChange={onPublishingChange} tags={tags} onTagsChange={onTagsChange} />
        </DisclosureContent>
      </Collapsible>
    ),
  };
}

function PdfSwitch({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  const t = useTranslations("evidenceLibraryConfiguration.sources");
  return <SourceSwitch label={t("pdfs")} checked={checked} onCheckedChange={onCheckedChange} />;
}

function PdfBand({ publishing, onPublishingChange, tags, onTagsChange }: {
  publishing: PdfPublishing;
  onPublishingChange: (publishing: PdfPublishing) => void;
  tags: TagRules;
  onTagsChange: (tags: TagRules) => void;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.sources");
  const current = tags.publish ?? DEFAULT_TAG_RULES.publish;
  const issue = tagRuleIssue("publish", current);
  const below = (text: string) => <span className="text-xs font-normal text-muted-foreground">{text}</span>;
  return (
    <section aria-label={t("pdfPublishing.label")} className="space-y-3 border-b border-border-subtle bg-muted/40 px-4 pb-4 pt-3.5">
      <Segmented
        fill
        label={t("pdfPublishing.label")}
        value={publishing}
        onChange={onPublishingChange}
        options={[
          { id: "tagged", label: t("pdfPublishing.tagged"), icon: Tag, below: below(t("pdfPublishing.taggedDetail")) },
          { id: "every", label: t("pdfPublishing.every"), icon: Documents, below: below(t("pdfPublishing.everyDetail")) },
        ]}
      />
      <ChipInput
        label={t("pdfPublishing.tags")}
        hint={publishing === "tagged" ? t("pdfPublishing.taggedHint") : t("pdfPublishing.everyHint")}
        values={current}
        placeholder={t("tagPlaceholder")}
        error={issue ? t(`tagRules.issues.${issue}`) : null}
        onChange={(publish) => onTagsChange({ ...tags, publish })}
      />
    </section>
  );
}
