"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

const linkClassName = "text-primary underline-offset-4 hover:underline font-medium";

export function PolicyLinks({
  className,
  onNavigate,
}: {
  className?: string;
  onNavigate?: () => void;
}) {
  const t = useTranslations("legal");

  return (
    <p className={className}>
      {t("learnMorePrefix")}{" "}
      <Link href="/privacy" className={linkClassName} onClick={onNavigate}>
        {t("privacyPolicy")}
      </Link>
      {" "}{t("and")}{" "}
      <Link href="/cookie-policy" className={linkClassName} onClick={onNavigate}>
        {t("cookiePolicy")}
      </Link>
    </p>
  );
}
