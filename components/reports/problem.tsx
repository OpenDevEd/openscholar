"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CircleX } from "@/components/icons";
import { AutoHeight } from "@/components/ui/auto-height";
import { contactPage } from "@/lib/billing/contact";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";

/**
 * What just went wrong, said in the page beside what its author did, where they are looking, and not in a corner of
 * the screen. It opens its own room, so what's below it slides instead of jumping.
 */
export function Problem({ children, className }: { children: ReactNode; /** Its spacing, as padding: a margin would show while it is empty. */ className?: string }) {
  return (
    <AutoHeight>
      {children ? (
        <p role="alert" className={cn("flex items-start gap-2 text-sm text-destructive", className)}>
          <CircleX className="mt-0.5 size-4 shrink-0" />
          {/* A file's name can be one long word: it breaks anywhere, so a phone shows all of it. */}
          <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
        </p>
      ) : null}
    </AutoHeight>
  );
}

type Said = {
  scope: string;
  words: string;
  /** The server gave no words of its own, so `words` say only what failed and the page says what to do about it. */
  unexplained?: { /** The page and the server are on different versions: the request named something the server doesn't take, or a function it doesn't have. */ outOfStep: boolean; /** The server's own name for the request, which finds it in the logs. */ reference?: string };
};

/**
 * One place's trouble: what it is, a way to say or clear it, and a handler for a failed request. The handler keeps
 * the server's own words when it gave some. When it gave none, `otherwise` says what failed and the page adds what to
 * do: reload when the page and the server are out of step, else try again and report it, quoting the request.
 * Given a `scope`, trouble belongs to the scope it was said in: an answer that comes back after the page has moved to
 * another report is never shown on that one.
 */
export function useProblem(scope = "") {
  const t = useTranslations("publishReports.flow");
  const [said, set] = useState<Said | null>(null);
  const say = (words: string | null) => set(words === null ? null : { words, scope });
  const failed = (otherwise: string) => (error: unknown) => {
    const words = getErrorMessage(error, otherwise);
    const raw = error instanceof Error ? error.message : "";
    set({
      scope,
      words,
      ...(words === otherwise && { unexplained: { outOfStep: /ArgumentValidationError|Could not find public function/.test(raw), reference: /\[Request ID: ([^\]]+)\]/.exec(raw)?.[1] } }),
    });
  };
  const link = (chunks: ReactNode) => (
    <a href={contactPage("bug")} target="_blank" rel="noreferrer" className="underline underline-offset-2">
      {chunks}
    </a>
  );
  const problem: ReactNode =
    said?.scope !== scope ? null : !said.unexplained ? (
      said.words
    ) : (
      <>
        {said.words}{" "}
        {said.unexplained.outOfStep ? t("problem.outOfStep") : said.unexplained.reference ? t.rich("problem.retryQuote", { link, reference: said.unexplained.reference }) : t.rich("problem.retry", { link })}
      </>
    );
  return { problem, say, failed };
}
