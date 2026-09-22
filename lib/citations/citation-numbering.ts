// CSL assets are trusted generated syntax trees. Remove the numbering node,
// including its punctuation, rather than stripping digits from rendered text.
type StyleNode = { name: string; attrs: Record<string, string>; children: (StyleNode | string)[] };

export function withoutCitationNumbers(style: unknown): unknown {
  const copy = structuredClone(style) as StyleNode;
  let removed = false;
  const bibliographies: StyleNode[] = [];
  function visit(node: StyleNode) {
    if (node.name === "bibliography") bibliographies.push(node);
    node.children = node.children.filter(child => {
      const number = typeof child !== "string" && ["text", "number", "label"].includes(child.name) && child.attrs.variable === "citation-number";
      if (number) removed = true;
      return !number;
    });
    for (const child of node.children) if (typeof child !== "string") visit(child);
  }
  visit(copy);
  if (removed) for (const node of bibliographies) delete node.attrs["second-field-align"];
  return copy;
}
