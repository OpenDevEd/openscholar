"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useFormatter, useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ModelPicker } from "@/components/models/model-picker";
import { LIST, Zone } from "@/components/settings/parts";
import { NodeCard, toMapModel, type MapModel } from "@/components/settings/model-map";
import { FREE_QUERY_DEFAULTS, FREE_QUERY_LIMITS, FREE_QUESTIONS_FLAG, type FreeQueryLimit } from "@/lib/ai/free-queries";
import { useAppToast } from "@/lib/toast";
import { getErrorMessage } from "@/lib/toast/use-app-toast";

type Settings = FunctionReturnType<typeof api.ai.freeQueries.settings>;

/** Lays out at full size behind the page's entrance while `settings` is still being read. */
const READING_MODEL: MapModel = { id: FREE_QUERY_DEFAULTS.modelId, name: "", inputPricePerMillion: 0, outputPricePerMillion: 0 };

/** The model, limits and switch of writing queries from questions free, and what it cost today. */
export function FreeQuestionsZone({ settings, on }: { settings: Settings | undefined; on: boolean }) {
  const t = useTranslations("settingsAdmin.ai.free");
  const tc = useTranslations("common");
  const format = useFormatter();
  const toast = useAppToast();
  const failed = (error: unknown) => {
    console.error("[settings] free questions change failed", error);
    toast.error(tc("somethingWentWrong"), getErrorMessage(error, tc("somethingWentWrong")));
  };
  const setEnabled = useMutation(api.featureFlags.admin.setEnabled);
  const setPick = useMutation(api.ai.freeQueries.setPick);
  const setLimits = useMutation(api.ai.freeQueries.setLimits);
  const saved = Object.fromEntries(FREE_QUERY_LIMITS.map((limit) => [limit, String((settings ?? FREE_QUERY_DEFAULTS)[limit])])) as Record<FreeQueryLimit, string>;
  const [draft, setDraft] = useState(saved);
  const changed = FREE_QUERY_LIMITS.some((limit) => draft[limit] !== saved[limit]);
  const valid = FREE_QUERY_LIMITS.every((limit) => /^[1-9]\d*$/.test(draft[limit]));
  const model = !settings ? READING_MODEL : settings.model ? toMapModel(settings.model, settings.effort ?? null) : undefined;
  const today = settings && {
    calls: settings.signedOut.calls + settings.signedIn.calls,
    cost: format.number(settings.signedOut.costUsd + settings.signedIn.costUsd, { style: "currency", currency: "USD", maximumFractionDigits: 4 }),
  };

  return (
    <Zone label={t("title")} aside={today && <span className="text-xs tabular-nums text-muted-foreground">{t("today", today)}</span>}>
      <ul className={LIST}>
        <li>
          <label className="flex cursor-pointer items-center justify-between gap-6 px-4 py-3.5 transition-colors hover:bg-muted">
            <span className="min-w-0">
              <span className="block text-sm font-medium">{t("switch")}</span>
              <span className="block text-xs text-muted-foreground">{t("switchHint")}</span>
            </span>
            <Switch checked={on} onCheckedChange={(enabled) => setEnabled({ key: FREE_QUESTIONS_FLAG, enabled }).catch(failed)} />
          </label>
        </li>
        <li className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3.5">
          <span className="min-w-0">
            <span className="block text-sm font-medium">{t("model")}</span>
            <span className="block text-xs text-muted-foreground">{model ? t("modelHint") : t("modelMissing")}</span>
          </span>
          <ModelPicker
            current={model}
            onChange={(picked, effort) => setPick({ modelId: picked._id!, ...(effort && { effort }) }).catch(failed)}
            efforts
            tasks={["questionToQuery"]}
            trigger={model ? <NodeCard model={model} paidBy="credits" interactive /> : <Button type="button" variant="outline" size="sm">{t("pickModel")}</Button>}
          />
        </li>
        <li className="px-4 py-3.5">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setLimits({ perAddress: Number(draft.perAddress), perPerson: Number(draft.perPerson), signedOutPerDay: Number(draft.signedOutPerDay), signedInPerDay: Number(draft.signedInPerDay) }).catch(failed);
            }}
          >
            {FREE_QUERY_LIMITS.map((limit) => (
              <label key={limit} className="min-w-36 flex-1 space-y-1">
                <span className="block text-xs text-muted-foreground">{t(`limits.${limit}`)}</span>
                <Input inputMode="numeric" value={draft[limit]} onChange={(event) => setDraft({ ...draft, [limit]: event.target.value.trim() })} className="h-9 tabular-nums" />
              </label>
            ))}
            <Button type="submit" size="sm" className="h-9" disabled={!changed || !valid}>{tc("save")}</Button>
          </form>
        </li>
      </ul>
    </Zone>
  );
}
