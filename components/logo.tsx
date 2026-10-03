"use client"
import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/lib/hooks";

// The brand mark, traced from the brand guidelines. Its arcs take three tones,
// set per theme by --logo-a, --logo-b and --logo-c in globals.css.
// public/icon.svg holds the same paths in the white version's colours.
const MARK_VIEW_BOX = "-0.51 -0.28 83.03 82.02";
const MARK_PATHS = {
  a: "M34.07 52.72C22.6 50.26 9.08 44.88 2.46 34.63C0.26 31.15 -0.51 26.95 0.33 22.91C0.83 20.56 2.04 18.22 3.46 16.32C3.74 15.94 4.38 14.91 4.68 14.62C6.31 13.07 8.46 11.16 10.34 9.95C15.33 6.78 20.78 4.38 26.48 2.83C28.17 2.38 29.84 2.09 31.55 1.74C33.64 1.31 35.34 0.76 37.49 0.74C39.25 0.72 41.22 0.16 43.04 0.21C43.92 0.21 48.37 -0.28 48.84 0.23C49.14 1.03 49 5.37 49 6.53C47.97 6.5 46.86 6.63 45.83 6.68C42.06 6.89 38.49 7.51 34.82 8.33C32.25 8.89 29.21 9.49 26.74 10.4C24.7 11.14 21.81 12.34 19.96 13.42C15.24 16.2 9.61 20.55 9.64 26.61C9.65 30.28 11.48 33.5 13.94 36.11C16.67 39.04 20.32 41.03 23.93 42.67C25.05 43.18 26.4 43.94 27.55 44.32C29.9 45.1 32.33 45.94 34.71 46.63C36.4 47.12 38.17 47.37 39.9 47.6C40.57 47.69 41.57 47.99 42.31 48.11C45.27 48.59 48.26 48.86 51.26 48.93C55.02 49 58.62 48.9 62.34 48.36C64.08 48.25 65.73 47.92 67.44 47.57C68.28 47.44 69.17 47.32 70.01 47.19C71.59 46.95 73.73 46.11 75.04 47.47C76.32 48.8 73.05 49.77 72.26 50.07C69.03 51.3 65.71 52.26 62.32 52.93C60.79 53.23 59.12 53.43 57.57 53.67C50.19 54.91 42.21 53.96 34.86 52.87C34.59 52.83 34.34 52.79 34.07 52.72Z",
  b: "M0.11 53.1C0.06 52.46 -0.04 51.88 0.13 51.27L0.26 51.16C0.55 51.28 1.76 53.11 2.18 53.61C4.13 55.89 6.16 57.96 8.52 59.82C10.77 61.59 13.25 63.05 15.74 64.43C29.57 72.12 46.65 75.48 62.39 74.6C65.46 74.43 68.49 74.19 71.54 73.78C74.6 73.37 78.47 72.3 81.5 72.7C82.52 74.65 81.95 74.72 79.99 75.36C62.41 81.1 42.69 81.74 25.03 76.02C15.03 72.78 0.25 65.26 0.11 53.1ZM0.11 53.1C0.06 52.46 -0.04 51.88 0.13 51.27L0.26 51.16C0.55 51.28 1.76 53.11 2.18 53.61C1.39 53.62 0.5 53.9 0.11 53.1ZM0.11 40.72C0.09 40.15 -0.03 38.23 0.23 37.84L0.39 37.86C0.67 38.16 1.12 39.11 1.37 39.56L1.21 39.64C0.99 39.32 0.76 38.85 0.48 38.69C0.11 39.02 0.29 40.13 0.11 40.72ZM61.01 28.01C61.78 27.99 64.9 27.81 65.37 28.17C65.52 28.6 65.4 32.23 65.23 32.81C64.42 33.07 61.62 33.06 60.64 33.13C58.24 33.28 55.22 33.27 52.84 33.62C47.35 34.44 41.42 35.68 36.35 37.97C34.67 38.72 32.94 40.18 31.09 40.91C30.75 40.8 30.36 40.65 30.02 40.53C29.03 40.2 25.63 38.92 25.13 38.18C25.24 37.31 27.92 35.81 28.7 35.36C38.26 29.7 50.08 28.23 61.01 28.01Z",
  c: "M0.11 40.72C0.09 40.15 -0.03 38.23 0.23 37.84L0.39 37.86C0.67 38.16 1.12 39.11 1.37 39.56C2.06 40.43 3.49 42.39 4.19 43.1C9.4 48.46 15.98 52.35 22.89 55.07C23.81 55.43 24.8 55.92 25.73 56.21C28.3 57.02 30.9 57.8 33.5 58.53C33.8 58.58 34.21 58.74 34.51 58.77C37.36 59.08 40.25 60.22 43.06 60.5C50.62 61.27 58.18 61.33 65.77 60.95C68.49 60.82 71.17 60.35 73.9 60.33C74.64 60.33 76.27 60.64 76.17 61.66C75.71 62.69 72.01 63.17 70.81 63.51C63.05 65.65 54.95 66.54 46.91 66.38C44.43 66.33 41.8 65.91 39.41 65.77C39.25 65.69 31.74 64.41 31.07 64.28C29.45 63.95 27.84 63.54 26.25 63.05C25.67 62.9 25.09 62.72 24.52 62.53C22.04 61.66 18.86 60.31 16.52 59.17C11.19 56.62 6.09 53.08 2.83 48.12C1.21 45.65 0.1 43.8 0.11 40.72ZM47 15.4C47.58 15.33 48.34 15.32 48.93 15.3C49.12 16.34 48.91 20.16 48.87 21.36C46.47 21.34 42.63 21.85 40.27 22.41C33.22 24.08 25.29 26.76 20.69 32.74C20.41 33.11 20 34.19 19.65 34.76C19 35.05 18.48 34.42 18.05 34.01C16.46 32.61 14.69 30.65 15.28 28.36C15.77 27.92 16.22 27.26 16.68 26.75C19.48 23.64 23.11 21.55 26.93 19.96C28.63 19.2 30.25 18.47 32.08 18.07C33.7 17.75 35.43 17.05 37.03 16.77C40.21 16.21 43.79 15.57 47 15.4Z",
};

/** The OpenScholar mark, in the colours of the theme it sits in. */
export function LogoMark({ className, label }: { className?: string; label?: string }) {
  return (
    <svg
      viewBox={MARK_VIEW_BOX}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("shrink-0", className)}
    >
      <path fill="var(--logo-a)" d={MARK_PATHS.a} />
      <path fill="var(--logo-b)" d={MARK_PATHS.b} />
      <path fill="var(--logo-c)" d={MARK_PATHS.c} />
    </svg>
  );
}

interface LogoProps {
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  clickable?: boolean;
  iconOnly?: boolean; // Force icon-only mode
  context?: "navbar" | "home" | "general"; // Context for automatic mobile behavior
}

const MARK_SIZE = { sm: "size-8", md: "size-10", lg: "size-12", xl: "size-16" };
const WORDMARK_SIZE = { sm: "text-lg", md: "text-2xl", lg: "text-4xl", xl: "text-6xl" };

export function Logo({
  size = "md",
  className,
  clickable = true,
  iconOnly = false,
  context = "general",
}: LogoProps) {
  const t = useTranslations("accessibility");
  const isMobile = useIsMobile();

  // Determine if we should show icon only
  const shouldShowIconOnly = iconOnly || (context === "navbar" && isMobile);

  // On home context + mobile, use one size down for better fit
  const sizeStepDown: Record<typeof size, typeof size> = {
    xl: "lg",
    lg: "md",
    md: "sm",
    sm: "sm",
  };
  const effectiveSize = context === "home" && isMobile ? sizeStepDown[size] : size;

  const logoContent = (
    <div className={cn("flex items-center gap-2 sm:gap-3 shrink-0", className)}>
      <LogoMark className={MARK_SIZE[effectiveSize]} label={shouldShowIconOnly ? t("logoAlt") : undefined} />
      {!shouldShowIconOnly && (
        <span className={cn("font-medium text-brand-ink leading-tight whitespace-nowrap", WORDMARK_SIZE[effectiveSize])}>
          OpenScholar
        </span>
      )}
    </div>
  );

  if (clickable) {
    return (
      <Link href="/" className="transition-opacity hover:opacity-80">
        {logoContent}
      </Link>
    );
  }

  return logoContent;
}
