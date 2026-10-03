"use client";

import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import { Switch } from "@/components/ui/switch";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useAppToast } from "@/lib/toast";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { FLAG_REGISTRY, type FlagName } from "@/lib/feature-flags/registry";
import { Enter, LIST, Zone } from "@/components/settings/parts";

/** Which message holds each flag's label and hint. */
const GROUPS = [
  {
    title: "billing",
    flags: [
      ["credits.enabled", "credits"],
      ["credits.topups", "topups"],
      ["subscriptions.enabled", "subscriptions"],
      ["subscriptions.plan.enterprise", "enterprise"],
    ],
  },
  {
    title: "extraction",
    flags: [
      ["extraction.enabled", "extraction"],
      ["extraction.start", "startJobs"],
      ["extraction.chat", "chat"],
      ["extraction.pdf", "pdf"],
    ],
  },
] as const satisfies ReadonlyArray<{ title: string; flags: ReadonlyArray<readonly [FlagName, string]> }>;

export default function SwitchesPage() {
  const t = useTranslations("settingsAdmin.switches");
  const tc = useTranslations("common");
  const toast = useAppToast();
  const { data: rows } = useProtectedQuery(api.featureFlags.queries.getAll, {});
  const setEnabled = useMutation(api.featureFlags.admin.setEnabled).withOptimisticUpdate((store, { key, enabled }) => {
    const current = store.getQuery(api.featureFlags.queries.getAll, {});
    if (current) store.setQuery(api.featureFlags.queries.getAll, {}, current.map((r) => (r.key === key ? { ...r, enabled } : r)));
  });
  const on = (key: FlagName) => rows?.find((r) => r.key === key)?.enabled ?? FLAG_REGISTRY[key].enabled;

  return (
    <Enter ready={rows !== undefined}>
      <div className="space-y-8">
        {GROUPS.map((group) => (
          <Zone key={group.title} label={t(`groups.${group.title}`)}>
            <ul className={LIST}>
              {group.flags.map(([key, copy]) => (
                <li key={key}>
                  <label className="flex cursor-pointer items-center justify-between gap-6 px-4 py-3.5 transition-colors hover:bg-muted">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{t(`flags.${copy}.label`)}</span>
                      <span className="block text-xs text-muted-foreground">{t(`flags.${copy}.hint`)}</span>
                    </span>
                    <Switch
                      checked={on(key)}
                      onCheckedChange={(enabled) =>
                        setEnabled({ key, enabled }).catch((error: unknown) => {
                          console.error("[settings] flag change failed", { key, error });
                          toast.error(tc("somethingWentWrong"), getErrorMessage(error, tc("somethingWentWrong")));
                        })
                      }
                    />
                  </label>
                </li>
              ))}
            </ul>
          </Zone>
        ))}
      </div>
    </Enter>
  );
}
