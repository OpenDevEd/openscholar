import Link from "next/link";
import { useTranslations } from "next-intl";
import { CookiePreferencesTrigger } from "@/components/cookie-consent-banner";

const footerLinkClassName =
  "text-xs text-muted-foreground hover:text-foreground transition-colors";

export function Footer() {
  const t = useTranslations("footer");

  return (
    <footer className="py-8 shrink-0">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <Link href="/privacy" className={footerLinkClassName}>
            {t("privacyPolicy")}
          </Link>
          <Link href="/cookie-policy" className={footerLinkClassName}>
            {t("cookiePolicy")}
          </Link>
          <CookiePreferencesTrigger />
          <span className="text-xs text-muted-foreground">
            {t("builtBy")}{" "}
            <a
              href="https://opendeved.net/"
              target="_blank"
              rel="sponsored"
              className={footerLinkClassName}
            >
              OpenDevEd
            </a>{" "}
            {t("and")}{" "}
            <a
              href="https://www.ekitabu.com/"
              target="_blank"
              rel="sponsored"
              className={footerLinkClassName}
            >
              eKitabu
            </a>{" "}
            {t("with")}{" "}
            <a
              href="https://openalex.org"
              target="_blank"
              rel="sponsored"
              className={footerLinkClassName}
            >
              OpenAlex
            </a>
            {t("suffix") && <> {t("suffix")}</>}
          </span>
        </div>
      </div>
    </footer>
  );
}
