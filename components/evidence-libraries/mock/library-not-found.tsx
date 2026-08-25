"use client";

import { ArrowLeft, Layers } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

export function LibraryNotFound() {
  const t = useTranslations("evidenceLibraryMock.config");
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
      <PageHeader
        title={t("notFoundTitle")}
        description={t("notFoundDescription")}
        icon={Layers}
      />
      <Button asChild variant="outline">
        <Link href="/evidence-libraries">
          <ArrowLeft />
          {t("backToLibraries")}
        </Link>
      </Button>
    </div>
  );
}
