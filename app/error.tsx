"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";

export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const t = useTranslations("errors");
  const tc = useTranslations("common");
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    console.error("[app/error]", error);
    headingRef.current?.focus();
  }, [error]);

  return (
    <div className="container mx-auto flex min-h-[60vh] items-center justify-center p-6">
      <div
        className="w-full max-w-lg rounded-xl border border-border bg-card p-8 text-center"
        role="alert"
      >
        <AlertTriangle className="mx-auto mb-4 h-8 w-8 text-muted-foreground" />
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="mb-2 text-2xl font-semibold outline-none"
        >
          {tc("somethingWentWrong")}
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {t("unexpectedIssue")}
        </p>
        <div className="flex justify-center gap-2">
          <Button onClick={unstable_retry}>{tc("retry")}</Button>
          <Button variant="outline" asChild>
            <Link href="/">{tc("goHome")}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
