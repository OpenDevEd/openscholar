"use client";

import { useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CopyIcon, DownloadIcon, Maximize2Icon } from "@/components/icons";
import type { BundledLanguage } from "shiki";
import {
  extractTableDataFromElement,
  tableDataToCSV,
  tableDataToMarkdown,
  tableDataToTSV,
} from "streamdown";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
} from "@/components/ai-elements/code-block";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TooltipHint } from "@/components/ui/tooltip";
import { useAppToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const TABLE_FORMATS = {
  md: { label: "Markdown", file: "table.md", type: "text/markdown", to: tableDataToMarkdown },
  csv: { label: "CSV", file: "table.csv", type: "text/csv", to: tableDataToCSV },
  tsv: { label: "TSV", file: "table.tsv", type: "text/tab-separated-values", to: tableDataToTSV },
} as const;
type TableFormat = keyof typeof TABLE_FORMATS;

const iconButton = "size-7 text-muted-foreground hover:text-foreground";

/** A table in an answer, with copy, download and full screen on the app's own menus and dialog. */
export function ChatTable({ children }: { children?: ReactNode }) {
  const t = useTranslations("extraction");
  const appToast = useAppToast();
  const tableRef = useRef<HTMLTableElement>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const text = (format: TableFormat) =>
    TABLE_FORMATS[format].to(extractTableDataFromElement(tableRef.current!));

  const copy = (format: TableFormat) => {
    void navigator.clipboard
      .writeText(text(format))
      .then(() => toast.success(t("chatCopied")))
      .catch(() => appToast.clipboard.copyFailed(t("chatTableCopy")));
  };

  const download = (format: TableFormat) => {
    const { file, type } = TABLE_FORMATS[format];
    const url = URL.createObjectURL(new Blob([text(format)], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = file;
    link.click();
    URL.revokeObjectURL(url);
  };

  const table = (
    <table className="w-full border-collapse text-sm">{children}</table>
  );

  return (
    <div
      data-streamdown="table-wrapper"
      className="group/table my-4 overflow-hidden rounded-lg border"
    >
      <div className="flex items-center justify-end gap-0.5 border-b bg-inset px-1.5 py-1">
        <DropdownMenu>
          <TooltipHint label={t("chatTableCopy")}>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label={t("chatTableCopy")} className={iconButton}>
                <CopyIcon className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipHint>
          <DropdownMenuContent align="end">
            {(["md", "csv", "tsv"] as const).map((format) => (
              <DropdownMenuItem key={format} onSelect={() => copy(format)}>
                {TABLE_FORMATS[format].label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <TooltipHint label={t("chatTableDownload")}>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label={t("chatTableDownload")} className={iconButton}>
                <DownloadIcon className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipHint>
          <DropdownMenuContent align="end">
            {(["csv", "md"] as const).map((format) => (
              <DropdownMenuItem key={format} onSelect={() => download(format)}>
                {TABLE_FORMATS[format].label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <TooltipHint label={t("chatTableFullscreen")}>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t("chatTableFullscreen")}
            className={iconButton}
            onClick={() => setFullscreen(true)}
          >
            <Maximize2Icon className="size-3.5" />
          </Button>
        </TooltipHint>
      </div>
      <div className="overflow-x-auto">
        <table ref={tableRef} className="w-full border-collapse text-sm">
          {children}
        </table>
      </div>
      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="max-h-[90vh] grid-rows-[auto_minmax(0,1fr)] sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>{t("chatTableTitle")}</DialogTitle>
          </DialogHeader>
          <div className="overflow-auto rounded-lg border">{table}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Code in an answer. Streamdown marks fenced code with `data-block`; that
 * renders on AI Elements' CodeBlock, and inline code keeps Streamdown's look.
 */
export function ChatCodeBlock({
  className,
  children,
  ...props
}: {
  className?: string;
  children?: ReactNode;
  "data-block"?: string;
}) {
  if (!("data-block" in props)) {
    return (
      <code
        data-streamdown="inline-code"
        className={cn("rounded bg-muted px-1.5 py-0.5 font-mono text-sm", className)}
      >
        {children}
      </code>
    );
  }
  return <FencedCode className={className}>{children}</FencedCode>;
}

function FencedCode({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const t = useTranslations("extraction");
  const language = /language-(\S+)/.exec(className ?? "")?.[1] ?? "text";
  const code = String(children ?? "").replace(/\n$/, "");
  return (
    <CodeBlock code={code} language={language as BundledLanguage} className="my-4">
      <CodeBlockHeader className="py-1 pr-1.5">
        <CodeBlockFilename>{language}</CodeBlockFilename>
        <CodeBlockActions className="my-0 mr-0">
          <TooltipHint label={t("chatCopyCode")}>
            <CodeBlockCopyButton aria-label={t("chatCopyCode")} className={iconButton} />
          </TooltipHint>
        </CodeBlockActions>
      </CodeBlockHeader>
    </CodeBlock>
  );
}
