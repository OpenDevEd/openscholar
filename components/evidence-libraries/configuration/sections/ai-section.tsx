"use client";

import { useAction, useMutation } from "convex/react";
import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AI_MODELS,
  AI_PROVIDER_KEY_PATH,
} from "@/lib/evidence-libraries/configuration/ai";
import { Field } from "../section-card";
import { FieldGroup, Panel, ReadOnlyValue, ToggleRow } from "../fields";
import { SectionShell, type SectionProps } from "../section-shell";

const KEY_INSTANCE = "openrouter";

/**
 * AI answers, through OpenRouter only. The switch is `features.ai`; the key
 * is a write-only credential the platform stores encrypted and adds to the
 * configuration when the library is published.
 */
export function AiSection({ libraryId, draft, saved, patch, reset }: SectionProps) {
  const t = useTranslations("evidenceLibraryConfiguration.ai");
  const enabled = draft.features.ai;
  const { keySaved, defaultModel } = draft.ai;
  const runtimeReady = AI_MODELS.length > 0;

  return (
    <SectionShell
      sectionKey="ai"
      icon={Sparkles}
      description={t("description")}
      draft={draft}
      saved={saved}
      reset={reset}
    >
      <FieldGroup title={t("answersLabel")} data-ai-enabled={enabled}>
        <ToggleRow
          label={t("answersLabel")}
          hint={t("answersHint")}
          checked={enabled}
          disabled={!runtimeReady}
          disabledReason={runtimeReady ? null : t("notReady")}
          onChange={(next) =>
            patch((d) => {
              d.features.ai = next;
              return d;
            })
          }
        />
        {enabled ? (
          <Panel tone="muted" className="ml-4 space-y-4">
            <ProviderKeyField libraryId={libraryId} keySaved={keySaved} />
            <Field
              label={t("modelLabel")}
              hint={t("modelHint")}
              className="max-w-sm"
              error={
                defaultModel !== "" && !AI_MODELS.includes(defaultModel)
                  ? t("modelError")
                  : null
              }
            >
              {(id) => (
                <Select
                  value={AI_MODELS.includes(defaultModel) ? defaultModel : undefined}
                  onValueChange={(value) =>
                    patch((d) => {
                      d.ai.defaultModel = value;
                      return d;
                    })
                  }
                >
                  <SelectTrigger id={id} className="w-full bg-background">
                    <SelectValue placeholder={t("modelPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {AI_MODELS.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          </Panel>
        ) : null}
      </FieldGroup>
    </SectionShell>
  );
}

/**
 * The stored key is never read back, so a saved key shows as a fact with
 * Replace and Remove beside it, the same way a connected Zotero group does.
 */
function ProviderKeyField({
  libraryId,
  keySaved,
}: {
  libraryId: Id<"evidenceLibraries">;
  keySaved: boolean;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.ai");
  const writeCredential = useAction(
    api.evidenceLibraries.credentialActions.writeCredential,
  );
  const removeKey = useMutation(
    api.evidenceLibraries.aiProviderKey.removeAiProviderKey,
  );
  const [value, setValue] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const editing = !keySaved || replacing;

  function saveKey() {
    setBusy(true);
    void writeCredential({
      libraryId,
      concretePath: AI_PROVIDER_KEY_PATH,
      instanceKey: KEY_INSTANCE,
      value: value.trim(),
    })
      .then(() => {
        setValue("");
        setReplacing(false);
        toast.success(t("keySavedToast"));
      })
      .catch(() => toast.error(t("keyError")))
      .finally(() => setBusy(false));
  }

  function remove() {
    setBusy(true);
    void removeKey({ libraryId })
      .then(() => {
        setValue("");
        setReplacing(false);
      })
      .catch(() => toast.error(t("keyRemoveError")))
      .finally(() => setBusy(false));
  }

  return (
    <Field label={t("keyLabel")} hint={t("keyHint")} className="max-w-sm">
      {(id) =>
        editing ? (
          <div className="flex items-center gap-2">
            <Input
              id={id}
              type="password"
              autoComplete="off"
              className="bg-background font-mono text-sm"
              placeholder="sk-or-"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={busy || value.trim() === ""}
              onClick={saveKey}
            >
              {busy ? <Spinner /> : null}
              {t("keySave")}
            </Button>
            {keySaved ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setValue("");
                  setReplacing(false);
                }}
              >
                {t("keyCancel")}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <ReadOnlyValue id={id} value={t("keyStored")} locked mono={false} />
            <Button
              type="button"
              variant="outline"
              onClick={() => setReplacing(true)}
            >
              {t("keyReplace")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={remove}
            >
              {busy ? <Spinner /> : null}
              {t("keyRemove")}
            </Button>
          </div>
        )
      }
    </Field>
  );
}
