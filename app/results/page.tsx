"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export default function ResultsPage() {
  const router = useRouter();
  const t = useTranslations("common");

  useEffect(() => {
    // Redirect to home page since we now use dynamic routes with search IDs
    router.replace("/");
  }, [router]);

  return (
    <div className="flex items-center justify-center py-20">
      <p>{t("redirecting")}</p>
    </div>
  );
} 