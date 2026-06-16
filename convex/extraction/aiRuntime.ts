"use node";

import type { ActionCtx } from "../_generated/server";
import { fetchServerPricing, getModel } from "../ai/helpers";

export type ExtractionModel = Awaited<ReturnType<typeof getModel>>;
export type ExtractionPricing = Awaited<ReturnType<typeof fetchServerPricing>>;

export async function getExtractionModel(): Promise<ExtractionModel> {
  return await getModel();
}

export async function getExtractionPricing(
  ctx: ActionCtx,
): Promise<ExtractionPricing> {
  return await fetchServerPricing(ctx);
}
