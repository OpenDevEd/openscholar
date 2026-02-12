"use client"

import * as React from "react"
import posthog from "posthog-js"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { useThemeToggleStore } from "@/lib/store"

export function ThemeToggle() {
  const t = useTranslations("accessibility")
  const { theme, setTheme } = useTheme()
  const { mounted, setMounted } = useThemeToggleStore()

  // Ensure component is mounted before showing theme-dependent content
  React.useEffect(() => {
    setMounted(true)
  }, [setMounted])

  const toggleTheme = () => {
    const previousTheme = theme;
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);

    // Track theme toggle
    posthog.capture("theme_toggled", {
      theme: newTheme,
      previous_theme: previousTheme,
    });
  }

  // Don't render anything until mounted to avoid hydration mismatch
  if (!mounted) {
    return (
      <Button 
        variant="ghost" 
        size="sm" 
        className="h-8 w-8 px-0" 
        onClick={toggleTheme}
        title={t("toggleTheme")}
      >
        <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        <span className="sr-only">{t("toggleTheme")}</span>
      </Button>
    )
  }

  return (
    <Button 
      variant="ghost" 
      size="sm" 
      className="h-8 w-8 px-0" 
      onClick={toggleTheme}
      title={theme === "dark" ? t("switchToLightMode") : t("switchToDarkMode")}
    >
      <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">{t("toggleTheme")}</span>
    </Button>
  )
} 