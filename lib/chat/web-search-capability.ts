export type WebSearchCapableModel = {
  supportedParameters?: string[] | null;
};

export function modelSupportsWebSearch(
  model: WebSearchCapableModel | null | undefined,
): boolean {
  if (!model) return false;
  const params = model.supportedParameters;
  if (!params || params.length === 0) return false;
  return params.includes("tools");
}
