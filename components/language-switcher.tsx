"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Check, Globe } from "@/components/icons";
import { motion, AnimatePresence } from "motion/react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { localeNames, locales, type Locale } from "@/i18n/config";
import { setLocale } from "@/i18n/locale";
import { TooltipHint } from "@/components/ui/tooltip";

interface LanguageSwitcherProps {
  isCollapsed?: boolean;
}

export function LanguageSwitcher({ isCollapsed }: LanguageSwitcherProps) {
  const t = useTranslations("common");
  const currentLocale = useLocale() as Locale;
  const getLocaleLabel = (locale: Locale) => localeNames[locale];
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const { isAuthenticated } = useConvexAuth();
  // Signed in, the choice is the account's, said at once: this browser's cookie follows it, as every other browser
  // the person is signed in on does (components/profile/profile-setup.tsx).
  const remember = useMutation(api.users.profileSetup.setLocale).withOptimisticUpdate((store, { locale }) => {
    const now = store.getQuery(api.users.profileSetup.get, {});
    if (now) store.setQuery(api.users.profileSetup.get, {}, { ...now, locale });
  });

  const handleLocaleChange = async (locale: Locale) => {
    // An account the backend can't write to yet (made a moment ago) still changes this browser's language.
    await (isAuthenticated ? remember({ locale }).catch(() => setLocale(locale)) : setLocale(locale));
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
          <span className="ms-2 text-sm">{getLocaleLabel(currentLocale)}</span>
        )}
      </Button>
    );
  }

  // Modal, so Tab stays in the list while it's open: it opens in a portal, outside the account card that keeps Tab in itself.
  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <motion.div
        tabIndex={-1}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        <TooltipHint label={t("language")}>
          <PopoverTrigger asChild>
            <Button
              aria-label={`${t("language")}: ${getLocaleLabel(currentLocale)}`}
              variant="ghost"
              size={isCollapsed ? "icon" : "sm"}
              className={cn(
                "h-8 transition-all duration-200 hover:bg-sidebar-accent",
                isCollapsed ? "w-8 px-0" : "w-auto px-2"
              )}
            >
              <Globe className="h-[1.2rem] w-[1.2rem]" />
              {!isCollapsed && (
                <span className="ms-2 text-sm">{getLocaleLabel(currentLocale)}</span>
              )}
            </Button>
          </PopoverTrigger>
        </TooltipHint>
      </motion.div>
      <PopoverContent
        align={isCollapsed ? "end" : "start"}
        className="w-48 p-1"
        side={isCollapsed ? "right" : "top"}
        sideOffset={isCollapsed ? 8 : 4}
      >
        <div
          className="space-y-0.5"
          // The arrow keys move through the languages, as they do through any list of choices.
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            const choices = [...event.currentTarget.querySelectorAll("button")];
            const at = choices.indexOf(document.activeElement as HTMLButtonElement);
            choices[(at + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length]?.focus();
          }}
        >
          {locales.map((locale) => (
            <motion.button
              key={locale}
              onClick={() => handleLocaleChange(locale)}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm transition-colors",
                currentLocale === locale
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent"
              )}
              whileHover={{ x: 2 }}
              whileTap={{ scale: 0.98 }}
            >
              <span lang={locale} className="flex-1 text-start">{getLocaleLabel(locale)}</span>
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
