"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import { useAppToast } from "@/lib/toast";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { AI_TASKS, DEFAULT_PRESET, PRESET_KEYS, type AiTask, type PresetKey } from "@/lib/ai/tasks";
import type { Effort } from "@/lib/ai/core/call-options";
import { Enter } from "@/components/settings/parts";
import {
  MapSummary, NodeCard, PresetSwitch, RoutingMap, usePresetModels, useRouting, type Hover, type MapModel, type PresetPick,
} from "@/components/settings/model-map";
import { ModelPicker } from "@/components/models/model-picker";

/** Each preset's model and effort for every task, drawn as the map users see. Click a task or a model card to change it. */
export default function AdminAiModelsPage() {
  const t = useTranslations("settingsAdmin.ai");
  const tc = useTranslations("common");
  const toast = useAppToast();
  const [hover, setHover] = useState<Hover>(null);
  const [preset, setPreset] = useState<PresetKey>(DEFAULT_PRESET);
  const presetModel = usePresetModels();
  const setPresetPick = useMutation(api.aiModelConfig.admin.setPresetPick);
  const modelOf = (task: AiTask) => presetModel?.(preset, task) ?? null;
  const routing = useRouting({ modelFor: modelOf });

  const route = (tasks: AiTask[], model: MapModel, effort?: Effort) => {
    for (const task of tasks) {
      setPresetPick({ preset, task, modelId: model._id!, ...(effort && { effort }) }).catch((error: unknown) => {
        console.error("[settings] preset pick failed", error);
        toast.error(tc("somethingWentWrong"), getErrorMessage(error, tc("somethingWentWrong")));
      });
    }
  };
  // The other presets' picks for these tasks, one click each.
  const presetPicks = (tasks: AiTask[]): PresetPick[] =>
    PRESET_KEYS.filter((id) => id !== preset).map((id) => {
      const picked = tasks.flatMap((task) => {
        const m = presetModel?.(id, task);
        return m ? [{ task, m }] : [];
      });
      return { id, models: picked.map(({ m }) => m), onSelect: () => picked.forEach(({ task, m }) => route([task], m, m.effort)) };
    });

  return (
    <Enter ready={presetModel !== undefined}>
      <div className="space-y-6">
        <PresetSwitch value={preset} onChange={setPreset} modelsOf={(p) => AI_TASKS.flatMap((task) => presetModel?.(p, task) ?? [])} />
        <MapSummary
          routing={routing}
          title={t("modelCount", { count: routing.modelCount })}
          hovered={hover?.node}
          onHover={(id) => setHover(id ? { node: id } : null)}
        />

        <RoutingMap
          routing={routing}
          hover={hover}
          setHover={setHover}
          browserLabel={t("creditsOrKey")}
          wrapTask={(task, row) => (
            <ModelPicker
              align="start"
              current={modelOf(task) ?? undefined}
              onChange={(m, effort) => route([task], m, effort)}
              efforts
              presets={presetPicks([task])}
              tasks={[task]}
              trigger={
                <button type="button" className="w-full rounded-l-xl">
                  {row}
                </button>
              }
            />
          )}
          renderNode={(n) => (
            <ModelPicker
              current={n.model}
              onChange={(m, effort) => route(n.tasks, m, effort)}
              efforts
              presets={presetPicks(n.tasks)}
                tasks={n.tasks}
              trigger={<NodeCard model={n.model} paidBy="credits" interactive />}
            />
          )}
        />
      </div>
    </Enter>
  );
}
