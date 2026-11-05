"use client";

import { useEffect } from "react";
import Link from "@/components/workspace-link";
import { AlertTriangle } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { useChunkReload } from "@/lib/chunk-reload";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");
  const tc = useTranslations("common");
  const { reloading, retry } = useChunkReload(error, reset);

  useEffect(() => {
    console.error("[app/error]", error);
  }, [error]);

  if (reloading) return null;

  return (
    <div className="container mx-auto flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-8 text-center">
        <AlertTriangle className="mx-auto mb-4 h-8 w-8 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-semibold">{tc("somethingWentWrong")}</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {t("unexpectedIssue")}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={retry}>{tc("retry")}</Button>
          <Button variant="outline" asChild>
            <Link href="/">{tc("goHome")}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
