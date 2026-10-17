"use client";

import { useTranslations } from "next-intl";
import type { ZoteroPdfPublishing } from "@/convex/zotero/sourceEntry";
import { Documents, Tag } from "@/components/icons";
import { Segmented } from "@/components/settings/parts";
import { Collapsible } from "@/components/ui/collapsible";
import { ChipInput } from "../fields";
import { DisclosureContent } from "../disclosure-button";
import { SourceSwitch } from "./source-row";
import { pdfPublishingIssue } from "./tag-rules";

/**
 * A Zotero row's PDFs switch and the band it opens: whether a PDF needs a publish tag, and the group's own tags that
 * publish one. Notes and links need one of the tags whatever the choice.
 */
export function sourcePdfs({ downloadPdfs, onDownloadPdfsChange, publishing, onPublishingChange, blockedTags }: {
  downloadPdfs: boolean;
  onDownloadPdfsChange: (downloadPdfs: boolean) => void;
  publishing: ZoteroPdfPublishing;
  onPublishingChange: (publishing: ZoteroPdfPublishing) => void;
  /** The library's hide and internal tags, which a publish tag can't also be. */
  blockedTags: readonly string[];
}) {
  return {
    control: <PdfSwitch checked={downloadPdfs} onCheckedChange={onDownloadPdfsChange} />,
    band: (
      <Collapsible open={downloadPdfs}>
        <DisclosureContent>
          <PdfBand publishing={publishing} onPublishingChange={onPublishingChange} blockedTags={blockedTags} />
        </DisclosureContent>
      </Collapsible>
    ),
  };
}

function PdfSwitch({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  const t = useTranslations("evidenceLibraryConfiguration.sources");
  return <SourceSwitch label={t("pdfs")} checked={checked} onCheckedChange={onCheckedChange} />;
}

function PdfBand({ publishing, onPublishingChange, blockedTags }: {
  publishing: ZoteroPdfPublishing;
  onPublishingChange: (publishing: ZoteroPdfPublishing) => void;
  blockedTags: readonly string[];
}) {
  const t = useTranslations("evidenceLibraryConfiguration.sources");
  const issue = pdfPublishingIssue(publishing, blockedTags);
  const below = (text: string) => <span className="text-xs font-normal text-muted-foreground">{text}</span>;
  return (
    <section aria-label={t("pdfPublishing.label")} className="space-y-3 border-b border-border-subtle bg-muted/40 px-4 pb-4 pt-3.5">
      <Segmented
        fill
        label={t("pdfPublishing.label")}
        value={publishing.mode}
        onChange={(mode) => onPublishingChange({ ...publishing, mode })}
        options={[
          { id: "tagged", label: t("pdfPublishing.tagged"), icon: Tag, below: below(t("pdfPublishing.taggedDetail")) },
          { id: "every", label: t("pdfPublishing.every"), icon: Documents, below: below(t("pdfPublishing.everyDetail")) },
        ]}
      />
      <ChipInput
        label={t("pdfPublishing.tags")}
        hint={publishing.mode === "tagged" ? t("pdfPublishing.taggedHint") : t("pdfPublishing.everyHint")}
        values={publishing.tags}
        placeholder={t("tagPlaceholder")}
        error={issue ? t(`tagRules.issues.${issue}`) : null}
        onChange={(tags) => onPublishingChange({ ...publishing, tags })}
      />
    </section>
  );
}
