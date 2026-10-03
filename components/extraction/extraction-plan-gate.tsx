"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { motion } from "motion/react";
import type { ComponentType, SVGProps } from "react";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  FileSearch,
  Sparkles,
  Users,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useFeatureFlag, useFlagPlanFeature } from "@/lib/feature-flags/hook";
import { useSubscriptionState } from "@/lib/auth/use-subscription-state";
import { plansWithFeature } from "@/lib/billing/catalog";

type Step = {
  title: string;
  description: string;
};

type ValueCard = {
  title: string;
  description: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

export function ExtractionPlanGate() {
  const t = useTranslations("extraction");
  const tp = useTranslations("pricing");
  const format = useFormatter();
  const subscriptionsEnabled = useFeatureFlag("subscriptions.enabled");
  // The plans that include extraction, as set in Autumn, cheapest first.
  const { catalog } = useSubscriptionState();
  const planFeature = useFlagPlanFeature("extraction.start");
  const plans = catalog && planFeature ? plansWithFeature(catalog, planFeature) : [];
  const cheapestPlan = plans[0]?.name;

  const steps: Step[] = [
    {
      title: t("planGateStep1Title"),
      description: t("planGateStep1Description"),
    },
    {
      title: t("planGateStep2Title"),
      description: t("planGateStep2Description"),
    },
    {
      title: t("planGateStep3Title"),
      description: t("planGateStep3Description"),
    },
  ];

  const cards: ValueCard[] = [
    {
      title: t("planGateCardOutcomesTitle"),
      description: t("planGateCardOutcomesDescription"),
      icon: BarChart3,
    },
    {
      title: t("planGateCardMethodsTitle"),
      description: t("planGateCardMethodsDescription"),
      icon: FileSearch,
    },
    {
      title: t("planGateCardPopulationTitle"),
      description: t("planGateCardPopulationDescription"),
      icon: Users,
    },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl border border-border-subtle bg-gradient-to-br from-primary/12 via-background to-info/10 p-6 md:p-8"
      >
        <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative space-y-4">
          {cheapestPlan && (
            <Badge variant="secondary" className="w-fit gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              {t("planGateBadge", { plan: cheapestPlan })}
            </Badge>
          )}
          <h1 className="max-w-3xl text-2xl md:text-3xl font-semibold tracking-tight text-foreground">
            {t("planGateTitle")}
          </h1>
          <p className="max-w-3xl text-sm md:text-base text-muted-foreground leading-relaxed">
            {t("planGateDescription")}
          </p>
          {subscriptionsEnabled && cheapestPlan && (
            <div className="flex flex-wrap gap-3 pt-1">
              <Button asChild>
                <Link href="/pricing" className="gap-2">
                  {t("planGatePrimaryCta", { plan: cheapestPlan })}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          )}
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.06 }}
        className="rounded-2xl border border-border-subtle bg-card p-5 md:p-6"
      >
        <h2 className="text-lg md:text-xl font-semibold text-foreground">
          {t("planGateHowItWorksTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("planGateHowItWorksDescription")}
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {steps.map((step, index) => (
            <div
              key={step.title}
              className="rounded-xl border border-border-subtle bg-inset p-4"
            >
              <div className="mb-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                {index + 1}
              </div>
              <p className="text-sm font-medium text-foreground">{step.title}</p>
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
        className="rounded-2xl border border-border-subtle bg-card p-5 md:p-6"
      >
        <h2 className="text-lg md:text-xl font-semibold text-foreground">
          {t("planGateWhatYouCanExtractTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("planGateWhatYouCanExtractDescription")}
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {cards.map(({ title, description, icon: Icon }) => (
            <div
              key={title}
              className="rounded-xl border border-border-subtle bg-inset p-4"
            >
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </div>
              <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                {description}
              </p>
            </div>
          ))}
        </div>
      </motion.section>

      {plans.length > 0 && (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border-subtle bg-inset px-4 py-3 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          {t("planGateNote", {
            plans: format.list([...plans.map((plan) => plan.name), tp("enterprisePlanName")], {
              type: "conjunction",
            }),
          })}
        </div>
      )}
    </div>
  );
}
