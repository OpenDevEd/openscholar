import Link from "next/link";
import { useTranslations } from "next-intl";
import { CookiePreferencesTrigger } from "@/components/cookie-consent-banner";

export function FooterBanner() {
  const t = useTranslations("footer");

  return (
    <div className="lg:text-base text-xs inline-flex flex-wrap justify-center items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-100/50 shadow-sm dark:from-orange-950/30 dark:to-amber-950/30 dark:border-orange-800/30">
      <span className="lg:text-sm text-xs text-muted-foreground">{t("builtBy")}</span>
      <a
        href="https://opendeved.net/"
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300 transition-colors"
      >
        OpenDevEd
      </a>
      <span className="lg:text-sm text-xs text-muted-foreground">{t("and")}</span>
      <a
        href="https://www.ekitabu.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300 transition-colors"
      >
        eKitabu
      </a>
      <span className="lg:text-sm text-xs text-muted-foreground">{t("with")}</span>
      <a
        href="https://openalex.org"
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300 transition-colors"
      >
        OpenAlex
      </a>
      {t("suffix") && (
        <span className="lg:text-sm text-xs text-muted-foreground">{t("suffix")}</span>
      )}
    </div>
  );
}

export function Footer() {
  const t = useTranslations("footer");

  return (
    <footer className="py-8 shrink-0">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="flex flex-col items-center gap-3">
          <FooterBanner />
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <Link
              href="/privacy"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("privacyPolicy")}
            </Link>
            <Link
              href="/cookie-policy"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("cookiePolicy")}
            </Link>
            <CookiePreferencesTrigger />
          </div>
        </div>
      </div>
    </footer>
  );
}
