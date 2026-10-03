"use client";

import { useMutation, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { toMapModel, usePresetModels, type MapModel, type PresetPick } from "@/components/settings/model-map";
import { useSignInRedirect } from "@/lib/auth/use-sign-in-redirect";
import { useSharedSubscriptionState } from "@/lib/auth/use-subscription-state";
import { useFeatureFlagForPlan } from "@/lib/feature-flags/hook";
import { useAppToast } from "@/lib/toast";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import type { Effort } from "@/lib/ai/core/call-options";
import { PRESET_KEYS, effectiveChoice, fallbackPreset, type AiTask, type ModelChoice } from "./tasks";

type Pick = { task: AiTask; modelId: Id<"models">; effort?: Effort };

/**
 * What each task runs on for the person, and how they change it: the AI settings page's
 * picks, read and written the same way wherever a model is picked. Picking a model for a
 * task saves it as a Custom pick, which keeps what every other task was running.
 */
export function useModelPicks() {
  const t = useTranslations("settingsAi");
  const tc = useTranslations("common");
  const toast = useAppToast();
  const { phase } = useAuthReadiness();
  const signedIn = phase === "authenticated";
  const goToSignIn = useSignInRedirect();
  const subscriptionState = useSharedSubscriptionState();
  const creditsEnabled = useFeatureFlagForPlan("credits.enabled", subscriptionState.planFeatures);

  const presetModel = usePresetModels();
  const settings = useQuery(api.userAiConfig.queries.get, signedIn ? {} : "skip");
  const choose = useMutation(api.userAiConfig.mutations.choose).withOptimisticUpdate((store, { choice }) => {
    const current = store.getQuery(api.userAiConfig.queries.get, {});
    if (current) store.setQuery(api.userAiConfig.queries.get, {}, { ...current, choice });
  });
  const saveCustom = useMutation(api.userAiConfig.mutations.setCustom);
  // Presets need credits; without them the user's own keys are all there is.
  const choice = effectiveChoice(creditsEnabled, settings?.choice);

  // A task with no live Custom pick runs on the preset it falls back to, as on the server.
  const customModel = (task: AiTask) => {
    const pick = settings?.custom.find((c) => c.task === task);
    return pick?.model ? toMapModel(pick.model, pick.effort) : (presetModel?.(fallbackPreset(settings?.choice), task) ?? null);
  };
  const modelsOf = (c: ModelChoice) => (task: AiTask) => (c === "custom" ? customModel(task) : (presetModel?.(c, task) ?? null));

  const fail = (what: string) => (error: unknown) => {
    console.error(`[settings] ${what} failed`, error);
    toast.error(tc("somethingWentWrong"), getErrorMessage(error, tc("somethingWentWrong")));
  };
  const requireSignIn = () => {
    if (signedIn) return true;
    toast.error(t("signInToPick"), undefined, { label: tc("signIn"), onClick: goToSignIn, icon: "arrow-right" });
    return false;
  };
  const setCustom = (picks: Pick[]) => {
    if (requireSignIn()) saveCustom({ picks }).catch(fail("model change"));
  };
  const pickAll = (tasks: AiTask[], model: MapModel, effort?: Effort) =>
    setCustom(tasks.map((task) => ({ task, modelId: model._id!, ...(effort && { effort }) })));
  // What each preset runs for these tasks; picking one copies those picks into Custom.
  const presetPicks = (tasks: AiTask[]): PresetPick[] =>
    PRESET_KEYS.map((id) => {
      const picked = tasks.flatMap((task) => {
        const m = presetModel?.(id, task);
        return m?._id ? [{ task, modelId: m._id, ...(m.effort && { effort: m.effort }), model: m }] : [];
      });
      return { id, models: picked.map((p) => p.model), onSelect: () => setCustom(picked.map(({ model: _, ...pick }) => pick)) };
    });

  return { signedIn, goToSignIn, creditsEnabled, presetModel, settings, choose, choice, modelsOf, modelOf: modelsOf(choice), fail, requireSignIn, pickAll, presetPicks };
}
