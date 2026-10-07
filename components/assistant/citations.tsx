"use client";

// What a reply cites (#648): pages of a PDF the person attached, as chips that open the PDF at
// that page, and web pages a search found, as chips with the page's site whose card shows what
// it is before the person leaves for it. Under a reply that searched, its web sources.

import { createContext, useContext, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { InlineCitation, InlineCitationCard, InlineCitationSource } from "@/components/ai-elements/inline-citation";
import { LinkSafetyDialog } from "@/components/ai-elements/link-safety-dialog";
import { Sources, SourcesContent, SourcesTrigger } from "@/components/ai-elements/sources";
import { ChevronDown, FileText, Globe } from "@/components/icons";
import { EASE } from "@/components/settings/model-map";
import { HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { RECORD_CHIP, recordChipStyle } from "./mentions";

export type WebSource = { title: string; url: string; excerpt: string };
type Cites = { files: ReadonlyMap<string, { name: string; url: string | null }>; sources: ReadonlyMap<string, WebSource> };

/** A reply's citation of a page of a PDF, as its text has it: `[p. 7](/files/FILE_ID#page=7)`. The match's first group is the file's ID. */
export const CITED_PDF = /\]\(\/files\/([^/#?)\s]+)#page=\d+\)/g;

/** The chat's attached files and what its searches found, which its replies cite. */
export const Cited = createContext<Cites>({ files: new Map(), sources: new Map() });

const CHIP = `${RECORD_CHIP} whitespace-nowrap transition-colors hover:bg-[color-mix(in_oklab,var(--tint)_28%,transparent)]`;
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** A link in a reply that cites a page of an attached PDF, or a web page a search found; null for any other. */
export function useCited(href: string | undefined, children: ReactNode) {
  const { files, sources } = useContext(Cited);
  const page = href?.match(/^\/files\/([^/#?]+)#page=(\d+)$/);
  if (page) {
    // By ID, or by a name the model wrote into the address, escaped or not.
    const file = files.get(page[1]) ?? files.get(safeDecode(page[1]));
    return <PageChip url={file?.url ?? null} page={Number(page[2])}>{children}</PageChip>;
  }
  const source = href ? (sources.get(href) ?? (href.startsWith("/") ? sourceAt(sources, href) : undefined)) : undefined;
  return source ? <WebCitation source={source} /> : null;
}

/**
 * A page a search found by its path alone: a model sometimes drops the site from an address it
 * cites, which would make it a page of the app. Only when one page found has that path: two
 * sites' pages could share it, and the citation can't say which.
 */
function sourceAt(sources: ReadonlyMap<string, WebSource>, path: string) {
  const matches = [...sources.values()].filter((source) => {
    try {
      const url = new URL(source.url);
      return url.pathname + url.search === path;
    } catch {
      return false;
    }
  });
  return matches.length === 1 ? matches[0] : undefined;
}

const safeDecode = (text: string) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/** A page of a PDF: opens it in a new tab at that page, while the PDF is still in the chat. */
function PageChip({ url, page, children }: { url: string | null; page: number; children: ReactNode }) {
  const inside = (
    <>
      <FileText className="mr-1 inline size-3 -translate-y-px" />
      {children}
    </>
  );
  return url ? (
    <a href={`${url}#page=${page}`} target="_blank" rel="noreferrer" className={CHIP} style={recordChipStyle("var(--kind-file)")}>
      {inside}
    </a>
  ) : (
    <span className={`${RECORD_CHIP} whitespace-nowrap`} style={recordChipStyle("var(--kind-file)")}>
      {inside}
    </span>
  );
}

/** A web page a search found, by its site: its card shows its title and what it says, and following it asks first, as any page outside the app does. */
function WebCitation({ source }: { source: WebSource }) {
  const [asking, setAsking] = useState(false);
  const host = hostOf(source.url);
  return (
    <InlineCitation>
      <InlineCitationCard openDelay={250} closeDelay={80}>
        <HoverCardTrigger asChild>
          <a
            href={source.url}
            rel="noreferrer"
            className={CHIP}
            style={recordChipStyle("var(--kind-web)")}
            onClick={(event) => {
              event.preventDefault();
              setAsking(true);
            }}
            onAuxClick={(event) => {
              if (event.button !== 1) return;
              event.preventDefault();
              setAsking(true);
            }}
          >
            <Globe className="mr-1 inline size-3 -translate-y-px" />
            {host}
          </a>
        </HoverCardTrigger>
        <HoverCardContent side="left" align="start" className="w-80 p-4">
          <InlineCitationSource title={source.title} url={host} description={source.excerpt || undefined} />
        </HoverCardContent>
      </InlineCitationCard>
      <LinkSafetyDialog
        isOpen={asking}
        url={source.url}
        onClose={() => setAsking(false)}
        onConfirm={() => {
          window.open(source.url, "_blank", "noreferrer");
          setAsking(false);
        }}
      />
    </InlineCitation>
  );
}

/** Under a reply that searched the web: what it found, folded to a count. */
export function WebSources({ sources }: { sources: readonly WebSource[] }) {
  const t = useTranslations("assistant");
  const [asking, setAsking] = useState<string | null>(null);
  if (!sources.length) return null;
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
      <Sources className="mb-0 text-muted-foreground">
        <SourcesTrigger count={sources.length} className="group -ml-2 h-7 rounded-full px-2 text-xs font-medium hover:bg-muted hover:text-foreground">
          <Globe className="size-3.5" style={{ color: "var(--kind-web)" }} />
          <span>{t("webSources", { count: sources.length })}</span>
          <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
        </SourcesTrigger>
        <SourcesContent className="w-full gap-1 pt-1">
          {sources.map((source) => (
            <a
              key={source.url}
              href={source.url}
              rel="noreferrer"
              onClick={(event) => {
                event.preventDefault();
                setAsking(source.url);
              }}
              className="flex h-11 items-center gap-2.5 rounded-xl px-2 hover:bg-muted/60"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: "color-mix(in oklab, var(--kind-web) 16%, transparent)", color: "var(--kind-web)" }}>
                <Globe className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-foreground">{source.title}</span>
                <span className="block truncate text-2xs">{hostOf(source.url)}</span>
              </span>
            </a>
          ))}
        </SourcesContent>
      </Sources>
      <LinkSafetyDialog
        isOpen={asking !== null}
        url={asking ?? ""}
        onClose={() => setAsking(null)}
        onConfirm={() => {
          if (asking) window.open(asking, "_blank", "noreferrer");
          setAsking(null);
        }}
      />
    </motion.div>
  );
}
