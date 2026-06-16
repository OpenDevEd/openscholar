export type OpenAlexIdentifiedSource = {
  openalexId?: string;
};

export function orderedOpenAlexIds(
  items: readonly OpenAlexIdentifiedSource[],
): string[] {
  return items.map((item) => item.openalexId?.trim() ?? "");
}

export function hasSameOrderedOpenAlexIds(
  a: readonly string[],
  b: readonly string[],
): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function assertNonEmptyOpenAlexSourceIds(ids: readonly string[]) {
  if (ids.length === 0) {
    throw new Error("At least one source is required to continue this chat.");
  }
  const missingIndex = ids.findIndex((id) => id.length === 0);
  if (missingIndex >= 0) {
    throw new Error(
      `Source ${missingIndex + 1} does not have an OpenAlex id.`,
    );
  }
}
