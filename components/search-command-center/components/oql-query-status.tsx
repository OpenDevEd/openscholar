"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { BookOpen } from "@/components/icons";
import { OQL_REFERENCE_URL } from "@/lib/openalex/oql";

/** The line under an OQL query: a link to the OQL reference. What the source refuses, the results area explains. */
export function OqlQueryStatus() {
  const t = useTranslations("searchCommand");

  return (
    <div className="mt-1.5 flex h-5 min-w-0 items-center gap-1.5 px-1 text-xs">
      <a
        href={OQL_REFERENCE_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        <BookOpen className="size-3.5" aria-hidden />
        {t("oqlReference")}
      </a>
    </div>
  );
}
