"use client";

import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import {
  previewOpenAlexSource,
  type OpenAlexSourcePreview,
} from "@/app/actions/openalex-source-preview";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  newOpenAlexQueryVersion,
  type OpenAlexQuery,
  type OpenAlexSourceEntry,
} from "@/lib/evidence-libraries/configuration/sources";
import { Field } from "../section-card";

export function OpenAlexSearchDialog({
  initial,
  onClose,
  onApprove,
}: {
  initial: OpenAlexSourceEntry | null;
  onClose: () => void;
  onApprove: (source: OpenAlexSourceEntry) => void;
}) {
  const [search, setSearch] = useState(
    initial?.settings.approvedQuery.query.search ?? "",
  );
  const [filter, setFilter] = useState(
    initial?.settings.approvedQuery.query.filter ?? "",
  );
  const [downloadPdfs, setDownloadPdfs] = useState(
    initial?.settings.downloadPdfs ?? false,
  );
  const [preview, setPreview] = useState<OpenAlexSourcePreview | null>(null);
  const [previewedQuery, setPreviewedQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const query: OpenAlexQuery = {
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(filter.trim() ? { filter: filter.trim() } : {}),
  };
  const queryKey = JSON.stringify(query);
  const approved = preview?.ok === true && previewedQuery === queryKey;

  async function runPreview() {
    setLoading(true);
    const result = await previewOpenAlexSource(query);
    setPreview(result);
    setPreviewedQuery(queryKey);
    setLoading(false);
  }

  function approve() {
    if (!approved) return;
    onApprove({
      key: initial?.key ?? `openalex-${crypto.randomUUID()}`,
      provider: "openalex",
      enabled: initial?.enabled ?? true,
      writebackEnabled: false,
      settings: {
        approvedQuery: {
          version: newOpenAlexQueryVersion(),
          approvedAt: new Date().toISOString(),
          query,
        },
        downloadPdfs,
      },
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {initial ? "Change OpenAlex search" : "Add OpenAlex search"}
          </DialogTitle>
          <DialogDescription>
            Preview the exact OpenAlex request, then approve this immutable
            version.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 py-2">
          <Field
            label="Search"
            hint="Words or a quoted OpenAlex search expression."
          >
            {(id) => (
              <Input
                id={id}
                value={search}
                maxLength={2_048}
                onChange={(event) => setSearch(event.target.value)}
              />
            )}
          </Field>
          <Field
            label="Filter"
            hint="OpenAlex filter syntax, for example publication_year:2020-2026."
          >
            {(id) => (
              <Input
                id={id}
                value={filter}
                maxLength={16_384}
                onChange={(event) => setFilter(event.target.value)}
              />
            )}
          </Field>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 p-3">
            <div>
              <p className="text-sm font-medium">Process PDFs</p>
              <p className="text-xs text-muted-foreground">
                Download and process available PDFs for this source.
              </p>
            </div>
            <Switch
              checked={downloadPdfs}
              onCheckedChange={setDownloadPdfs}
              aria-label="Process PDFs"
            />
          </div>
          <div className="space-y-3 rounded-lg border border-border/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Preview</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading || (!query.search && !query.filter)}
                onClick={() => void runPreview()}
              >
                {loading ? <Loader2 className="animate-spin" /> : <Search />}
                Preview query
              </Button>
            </div>
            {preview?.ok === false ? (
              <p className="text-sm text-destructive">{preview.message}</p>
            ) : null}
            {preview?.ok === true ? (
              preview.works.length ? (
                <ul className="divide-y divide-border/50">
                  {preview.works.map((work) => (
                    <li key={work.id} className="py-2 first:pt-0 last:pb-0">
                      <p className="text-sm font-medium">{work.title}</p>
                      {work.publicationYear ? (
                        <p className="text-xs text-muted-foreground">
                          {work.publicationYear}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No matching works.
                </p>
              )
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={!approved} onClick={approve}>
            Approve source
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
