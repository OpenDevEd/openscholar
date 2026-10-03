"use client"

import posthog from "posthog-js"
import { Check, Palette } from "lucide-react"
import { useTheme } from "next-themes"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { TooltipHint } from "@/components/ui/tooltip"
import { LogoMark } from "@/components/logo"
import { THEMES } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

/** The four themes as tiles, each drawn in its own colours with the logo as the brand guidelines show it. */
export function ThemeTiles({ className }: { className?: string }) {
  const t = useTranslations("theme")
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <div role="radiogroup" aria-label={t("label")} className={cn("grid grid-cols-2 gap-2", className)}>
      {THEMES.map((name) => {
        const selected = resolvedTheme === name
        return (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => {
              setTheme(name)
              posthog.capture("theme_toggled", { theme: name, previous_theme: resolvedTheme })
            }}
            className={cn(
              "overflow-hidden rounded-lg border outline-none transition-[border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring",
              selected ? "border-primary ring-1 ring-primary" : "hover:border-foreground/40",
            )}
          >
            {/* The theme's class puts its tokens on the tile. */}
            <span className={cn(name, "relative flex h-20 flex-col items-center justify-center gap-2 bg-background text-xs font-medium text-brand-ink")}>
              <LogoMark className="size-7" />
              {t(name)}
              {selected && <Check className="absolute right-1.5 top-1.5 size-3.5" aria-hidden />}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function ThemeSelector({ isCollapsed }: { isCollapsed?: boolean }) {
  const t = useTranslations("theme")

  return (
    <Popover>
      <TooltipHint label={t("label")}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={t("label")} className="h-8 w-8 px-0 hover:bg-sidebar-accent/80">
            <Palette className="h-[1.2rem] w-[1.2rem]" />
          </Button>
        </PopoverTrigger>
      </TooltipHint>
      <PopoverContent
        align={isCollapsed ? "end" : "start"}
        className="w-64 p-2"
        side={isCollapsed ? "right" : "top"}
        sideOffset={isCollapsed ? 8 : 4}
      >
        <ThemeTiles />
      </PopoverContent>
    </Popover>
  )
}
