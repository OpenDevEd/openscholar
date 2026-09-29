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

/** Whether a chat turn searches the web: the thread has it on and its model can call tools. */
export function chatSearchesWeb(thread: {
  webSearchEnabled?: boolean;
  modelSupportedParameters?: string[] | null;
}): boolean {
  return (
    thread.webSearchEnabled === true &&
    modelSupportsWebSearch({ supportedParameters: thread.modelSupportedParameters })
  );
}
