"use client";

// A report's DOCiD where a report is shown (plans/identifier-services): on its page, beside its registrations, on a
// withdrawn report's page, and in the reviewer's decline. A DOCiD is a Handle under 20.500.14351, resolved through
// hdl.handle.net, and it can't be deleted: a report taken down keeps it, pointing at a retired page.
// MOCK (mock/identifier-services): shown when DOCiD is used in this browser's settings (identifiers-mock-store.ts),
// with a made-up Handle from the report's key and English words.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { Button } from "@/components/ui/button";
import { TooltipHint } from "@/components/ui/tooltip";
import { Check, Copy, ExternalLink, TriangleAlert } from "@/components/icons";
import { copyText } from "@/components/copy-text";
import { useMockDocid, useMockIdentifiers } from "@/lib/reports/identifiers-mock-store";

/** MOCK: a Handle that looks like DOCiD's, the same for a report every time. */
export function mockHandleOf(key: string) {
  let hash = 0;
  for (const c of key) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return `20.500.14351/${hash.toString(16).slice(0, 6).padStart(6, "0")}`;
}
export const handleUrl = (handle: string) => `https://hdl.handle.net/${handle}`;

/** Whether reports get DOCiDs at all in this browser's mock settings. */
export function useDocidOn() {
  const ids = useMockIdentifiers();
  const docid = useMockDocid();
  return docid.on && ids.services.docid.mode !== "off";
}

function DocidMark({ className = "h-4" }: { className?: string }) {
  return <img src="/brands/docid.png" alt="DOCiD" className={`${className} w-auto shrink-0`} />;
}

/** The Handle, with copying and opening it, as the DOI is shown. */
function HandleLine({ handle, retired = false }: { handle: string; retired?: boolean }) {
  const tToast = useTranslations("toast");
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-sm">
      <span dir="ltr" className={`min-w-0 truncate font-mono ${retired ? "text-muted-foreground" : ""}`}>{handle}</span>
      <TooltipHint label="Copy the DOCiD">
        <Button variant="ghost" size="icon-xs" aria-label="Copy the DOCiD" className="text-muted-foreground" onClick={() => void copyText(handleUrl(handle), { copied: "DOCiD copied", failed: tToast("couldntCopy"), select: tToast("copyFailedDescription") })}>
          <Copy />
        </Button>
      </TooltipHint>
      <TooltipHint label="Open the DOCiD">
        <Button variant="ghost" size="icon-xs" aria-label="Open the DOCiD" className="text-muted-foreground" asChild>
          <a href={handleUrl(handle)} target="_blank" rel="noopener noreferrer">
            <ExternalLink />
          </a>
        </Button>
      </TooltipHint>
    </span>
  );
}

/** On a live report's page, under its DOI and drawn as the DOI is: its DOCiD, which opens on hdl.handle.net. */
export function ReportDocidLine({ reportKey }: { reportKey: string }) {
  const tToast = useTranslations("toast");
  const [copied, setCopied] = useState(false);
  if (!useDocidOn()) return null;
  const handle = mockHandleOf(reportKey);
  return (
    <p className="mt-1 flex items-center gap-2 text-sm">
      <span className="inline-flex h-5 items-center rounded bg-inset px-1.5 text-[11px] font-semibold text-muted-foreground">DOCiD</span>
      <a href={handleUrl(handle)} target="_blank" rel="noopener noreferrer" dir="ltr" className="min-w-0 truncate font-mono text-[13px] hover:text-primary hover:underline">{handle}</a>
      <TooltipHint label={copied ? "DOCiD copied" : "Copy the DOCiD"}>
        <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground" aria-label="Copy the DOCiD" onClick={async () => {
          setCopied(await copyText(handleUrl(handle), { copied: "DOCiD copied", failed: tToast("couldntCopy"), select: tToast("copyFailedDescription") }));
        }}>{copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}</Button>
      </TooltipHint>
    </p>
  );
}

/** MOCK: a refused DOCiD is shown with `docidRefused` in the address. */
export const useMockRefused = () => useSearchParams().has("docidRefused");

/** Beside a report's other registrations: its DOCiD's. */
export function DocidChip({ withdrawn = false }: { withdrawn?: boolean }) {
  const refused = useMockRefused();
  if (!useDocidOn()) return null;
  if (refused) return <StatusChip tone="warning" icon="tone">DOCiD refused it</StatusChip>;
  return (
    <StatusChip tone={withdrawn ? "neutral" : "success"} icon="tone">
      {withdrawn ? "DOCiD shows it retired" : "DOCiD registered"}
    </StatusChip>
  );
}

/** What DOCiD said when it refused a report, for the reviewer, with the way to send it again. */
export function DocidRefusal({ onRetry }: { onRetry: () => void }) {
  const refused = useMockRefused();
  if (!useDocidOn() || !refused) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-inset px-3.5 py-3">
      <TriangleAlert className="size-4 shrink-0 ink-warning" />
      <p className="min-w-0 flex-1 basis-56 text-sm text-pretty">
        DOCiD said: <span className="text-muted-foreground">&ldquo;Resource type not permitted for your account.&rdquo;</span> Ask the Africa PID Alliance to allow the resource type set under Registration, then send it again.
      </p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Send again
      </Button>
    </div>
  );
}

/** On a withdrawn report's page: its DOCiD stays, as its DOI does, and now shows a retired page. */
export function WithdrawnDocid({ reportKey }: { reportKey: string }) {
  if (!useDocidOn()) return null;
  return (
    <div className="mt-1 flex min-w-0 items-center gap-2">
      <span className="inline-flex h-5 shrink-0 items-center rounded bg-inset px-1.5 text-[11px] font-semibold text-muted-foreground">DOCiD</span>
      <HandleLine handle={mockHandleOf(reportKey)} retired />
    </div>
  );
}

/** In the reviewer's decline or withdrawal: what happens to a DOCiD that already exists. */
export function DocidWhenTakenDown({ minted }: { /** Minted at signing, or the report is live. */ minted: boolean }) {
  const on = useDocidOn();
  if (!on || !minted) return null;
  return (
    <p className="flex items-start gap-2 rounded-xl bg-inset px-3 py-2.5 text-xs text-pretty text-muted-foreground">
      <DocidMark className="mt-px h-3.5" />
      Its DOCiD can&apos;t be deleted. It will show a retired page instead of the report.
    </p>
  );
}
