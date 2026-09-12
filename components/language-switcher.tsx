"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Globe } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { locales, type Locale } from "@/i18n/config";
import { setLocale } from "@/i18n/locale";

const LOCALE_TO_LABEL_KEY: Record<Locale, string> = {
  "en-US": "enUS",
  "en-GB": "enGB",
  zh: "zh",
  fr: "fr",
  hi: "hi",
  ja: "ja",
};

const localeFlags: Record<Locale, string> = {
  "en-US": "🇺🇸",
  "en-GB": "🇬🇧",
  zh: "🇨🇳",
  fr: "🇫🇷",
  hi: "🇮🇳",
  ja: "🇯🇵",
};

interface LanguageSwitcherProps {
  isCollapsed?: boolean;
}

export function LanguageSwitcher({ isCollapsed }: LanguageSwitcherProps) {
  const t = useTranslations("common");
  const currentLocale = useLocale() as Locale;
  const getLocaleLabel = (locale: Locale) =>
    t(`localeLabels.${LOCALE_TO_LABEL_KEY[locale]}` as "localeLabels.enUS");
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const handleLocaleChange = async (locale: Locale) => {
    await setLocale(locale);
    setOpen(false);
  };

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        aria-label={t("language")}
        size={isCollapsed ? "icon" : "sm"}
        className={cn(
          "h-8 transition-all duration-200",
          isCollapsed ? "w-8 px-0" : "w-auto px-2"
        )}
      >
        <Globe className="h-[1.2rem] w-[1.2rem]" />
        {!isCollapsed && (
          <span className="ml-2 text-sm">{getLocaleLabel(currentLocale)}</span>
        )}
      </Button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <motion.div
        tabIndex={-1}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        <PopoverTrigger asChild>
          <Button
            aria-label={`${t("language")}: ${getLocaleLabel(currentLocale)}`}
            variant="ghost"
            size={isCollapsed ? "icon" : "sm"}
            className={cn(
              "h-8 transition-all duration-200 hover:bg-sidebar-accent/80",
              isCollapsed ? "w-8 px-0" : "w-auto px-2"
            )}
            title={t("language")}
          >
            <span className="text-base leading-none">
              {localeFlags[currentLocale]}
            </span>
            {!isCollapsed && (
              <span className="ml-2 text-sm">{getLocaleLabel(currentLocale)}</span>
            )}
          </Button>
        </PopoverTrigger>
      </motion.div>
      <PopoverContent
        align={isCollapsed ? "end" : "start"}
        className="w-48 p-1"
        side={isCollapsed ? "right" : "top"}
        sideOffset={isCollapsed ? 8 : 4}
      >
        <div className="space-y-0.5">
          {locales.map((locale) => (
            <motion.button
              key={locale}
              onClick={() => handleLocaleChange(locale)}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm transition-colors",
                currentLocale === locale
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50"
              )}
              whileHover={{ x: 2 }}
              whileTap={{ scale: 0.98 }}
            >
              <span className="text-base leading-none">{localeFlags[locale]}</span>
              <span className="flex-1 text-left">{getLocaleLabel(locale)}</span>
              <AnimatePresence>
                {currentLocale === locale && (
                  <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  >
                    <Check className="h-4 w-4 text-primary" />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
