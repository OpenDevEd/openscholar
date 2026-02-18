"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/logo";

export function HomeHero() {
  const t = useTranslations("home");
  const shouldReduceMotion = useReducedMotion();

  const logoTransition = shouldReduceMotion
    ? { duration: 0 }
    : { delay: 0.1, duration: 0.6, ease: [0.16, 1, 0.3, 1] as const };
  const taglineTransition = shouldReduceMotion
    ? { duration: 0 }
    : { delay: 0.3, duration: 0.6 };

  return (
    <div className="flex flex-col items-center text-center gap-6 mb-8 sm:mb-12 relative z-10 w-full max-w-4xl mx-auto px-4">
      {/* Main Title with inline Logo */}
      <div className="space-y-2">
        <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight text-foreground flex items-baseline justify-center">
          <motion.span
            initial={shouldReduceMotion ? false : { y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={logoTransition}
          >
            <Logo size="xl" clickable={false} context="home" />
          </motion.span>
        </h1>

        <motion.p
          initial={shouldReduceMotion ? false : { y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={taglineTransition}
          className="text-base sm:text-lg md:text-xl text-muted-foreground font-medium max-w-2xl mx-auto leading-relaxed"
        >
          {t("tagline")}
        </motion.p>
      </div>
    </div>
  );
}
