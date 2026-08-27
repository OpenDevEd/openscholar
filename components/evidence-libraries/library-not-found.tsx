"use client";

import { ArrowLeft, Layers } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CommandCenterContainer } from "@/components/command-center/command-center-container";
import { Button } from "@/components/ui/button";

export function LibraryNotFound() {
  const t = useTranslations("evidenceLibraries.notFound");
  return (
    <div className="container mx-auto max-w-4xl p-4 sm:p-6">
      <CommandCenterContainer>
        <div
          role="status"
          data-library-not-found
          className="relative flex flex-col items-center justify-center px-6 py-14 text-center sm:px-10"
        >
          <div className="mb-5 rounded-2xl border border-border/60 bg-background/80 p-4 shadow-sm">
            <Layers className="h-7 w-7 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight">{t("title")}</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            {t("description")}
          </p>
          <div className="mt-6">
            <Button asChild variant="outline" className="rounded-xl">
              <Link href="/evidence-libraries">
                <ArrowLeft />
                {t("back")}
              </Link>
            </Button>
          </div>
        </div>
      </CommandCenterContainer>
    </div>
  );
}
