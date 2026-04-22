import { api } from "@/convex/_generated/api";

export type ChatModelRow =
  (typeof api.chat.model.listChatModels)["_returnType"][number];

export function sortChatModels(models: readonly ChatModelRow[]) {
  return [...models].sort((a, b) => a.sortOrder - b.sortOrder);
}
