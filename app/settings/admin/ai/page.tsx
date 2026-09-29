"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { Brain, Scale, Zap } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useAppToast } from "@/lib/toast";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import type { AiTask } from "@/lib/ai/tasks";
import type { PresetKey } from "@/lib/ai/resolve-server-model";
import { Enter, Zone, type Ico } from "@/components/settings/parts";
import {
  MapSummary, ModelPicker, NodeCard, RoutingMap, toMapModel, useRouting, type Hover, type PickedModel,
} from "@/components/settings/model-map";

const summaryOf = (m: PickedModel) => ({
  _id: m._id,
  modelId: m.id,
  name: m.name,
  inputPricePerMillion: m.inputPricePerMillion,
  outputPricePerMillion: m.outputPricePerMillion,
});

const SHORTCUT_ICONS: Record<PresetKey, Ico> = { fast: Zap, balanced: Scale, intelligent: Brain };

/** What Recommended runs, drawn as the map users see. Click a task or a model card to change it. */
export default function AdminAiModelsPage() {
  const t = useTranslations("settingsAdmin.ai");
  const tc = useTranslations("common");
  const toast = useAppToast();
  const [hover, setHover] = useState<Hover>(null);
  const routes = useQuery(api.aiModelConfig.queries.routing, {});

  const setTaskModel = useMutation(api.aiModelConfig.admin.setTaskModel);
  const setPresetModel = useMutation(api.aiModelConfig.admin.setPresetModel);
  const fail = (error: unknown) => {
    console.error("[settings] AI model change failed", error);
    toast.error(tc("somethingWentWrong"), getErrorMessage(error, tc("somethingWentWrong")));
  };
  // Bound per pick, so the optimistic update has the picked model's name and prices.
  const route = (tasks: AiTask[], m: PickedModel) => {
    const picked = summaryOf(m);
    const run = setTaskModel.withOptimisticUpdate((store) => {
      const current = store.getQuery(api.aiModelConfig.queries.routing, {});
      if (current) {
        store.setQuery(api.aiModelConfig.queries.routing, {}, {
          ...current,
          tasks: current.tasks.map((r) => (tasks.includes(r.task) ? { ...r, model: picked } : r)),
        });
      }
    });
    for (const task of tasks) run({ task, modelId: picked._id }).catch(fail);
  };
  const setShortcut = (preset: PresetKey, m: PickedModel) => {
    const picked = summaryOf(m);
    setPresetModel
      .withOptimisticUpdate((store) => {
        const current = store.getQuery(api.aiModelConfig.queries.routing, {});
        if (current) {
          store.setQuery(api.aiModelConfig.queries.routing, {}, {
            ...current,
            presets: current.presets.map((r) => (r.preset === preset ? { ...r, model: picked } : r)),
          });
        }
      })({ preset, modelId: picked._id })
      .catch(fail);
  };

  const routing = useRouting({
    modelFor: (task) => {
      const m = routes?.tasks.find((r) => r.task === task)?.model;
      return m ? toMapModel(m) : null;
    },
  });

  return (
    <Enter ready={routes !== undefined}>
      <div className="space-y-8">
        <MapSummary
          routing={routing}
          title={t("modelCount", { count: routing.creditModels })}
          subtitle={t("behindRecommended")}
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
              value={routes?.tasks.find((r) => r.task === task)?.model?.modelId}
              onChange={(m) => route([task], m)}
              trigger={
                <button type="button" className="w-full rounded-l-xl">
                  {row}
                </button>
              }
            />
          )}
          renderNode={(n) => (
            <ModelPicker
              value={n.model.id}
              onChange={(m) => route(n.tasks, m)}
              trigger={<NodeCard model={n.model} paidBy="credits" count={n.tasks.length} interactive />}
            />
          )}
        />

        <Zone label={t("chatShortcuts")}>
          <div className="grid gap-3 @min-[46rem]/configuration:grid-cols-3">
            {(routes?.presets ?? []).map(({ preset, model }) => {
              const Icon = SHORTCUT_ICONS[preset];
              const caption = (
                <>
                  <Icon className="size-3" /> {t(`shortcuts.${preset}`)}
                </>
              );
              return (
                <ModelPicker
                  key={preset}
                  value={model?.modelId}
                  onChange={(m) => setShortcut(preset, m)}
                  trigger={
                    <NodeCard
                      model={model ? toMapModel(model) : { id: "", name: t("notSet"), inputPricePerMillion: 0, outputPricePerMillion: 0, unpriced: true }}
                      paidBy="credits"
                      count={0}
                      interactive
                      caption={caption}
                    />
                  }
                />
              );
            })}
          </div>
        </Zone>
      </div>
    </Enter>
  );
}
