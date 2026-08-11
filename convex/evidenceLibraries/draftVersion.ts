export function nextDraftEditVersion(
  currentEditVersion: number,
  _expectedEditVersion: number,
): number {
  return currentEditVersion + 1;
}
