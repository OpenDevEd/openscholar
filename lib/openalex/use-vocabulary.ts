"use client";

import { useTranslations } from "next-intl";
import { INSTITUTION_TYPES, SDGS, STUDY_DESIGNS, WORK_TYPES } from "./vocabulary";

/**
 * OpenAlex's terms in the reader's language. OpenAlex, its filters and the registries keep the English of
 * ./vocabulary.ts; this is only what a person reads. A term the messages don't hold (a work type OpenAlex added
 * since) reads as OpenAlex writes it.
 */
export function useVocabulary() {
  // Read by ids built at run time ("sdg.3", "workType.report"), which next-intl's key types can't follow.
  const t = useTranslations("vocabulary") as unknown as { (key: string): string; has(key: string): boolean };
  const named = (group: string, id: string, fallback: string) => (t.has(`${group}.${id}`) ? t(`${group}.${id}`) : fallback);
  /** A goal by its number or its UN address (https://metadata.un.org/sdg/3). */
  const sdg = (idOrUrl: string, fallback = idOrUrl) => named("sdg", idOrUrl.split("/").at(-1)!, fallback);
  const workType = (id: string) => named("workType", id, id.replace(/-/g, " "));
  const studyDesign = (id: string, fallback = id) => named("studyDesign", id, fallback);
  return {
    sdg,
    workType,
    studyDesign,
    sdgs: SDGS.map((goal) => ({ ...goal, name: `${goal.id}. ${sdg(goal.id, goal.name)}` })),
    workTypes: WORK_TYPES.map((type) => ({ ...type, name: workType(type.id) })),
    studyDesigns: STUDY_DESIGNS.map((design) => ({ ...design, name: studyDesign(design.id, design.name) })),
    institutionTypes: INSTITUTION_TYPES.map((type) => ({ ...type, name: named("institutionType", type.id, type.name) })),
  };
}

export type Vocabulary = ReturnType<typeof useVocabulary>;
