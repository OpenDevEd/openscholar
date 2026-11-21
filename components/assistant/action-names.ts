/**
 * A remark plugin for replies: an action's own name the model wrote, such as `extraction/start:extract` or
 * research_papers_search, shows as the name its step has in the chat, "Start an extraction". The instructions say
 * never to name them, and Claude Haiku 5.5 on the Cheap preset did anyway. Unknown names, and names inside a code
 * block, are left as they are.
 */
import type { Emphasis, Root } from "mdast";
import { findAndReplace } from "mdast-util-find-and-replace";
import { actionNamed } from "@/lib/assistant/actions";

/** What an action's name looks like: a path with its colon, or a tool's name with its underscores. */
const NAME = /[A-Za-z]+(?:\/[A-Za-z]+)*:[A-Za-z]+|[a-z]+(?:_[A-Za-z]+)+/g;

const shown = (label: string): Emphasis => ({ type: "emphasis", children: [{ type: "text", value: label }] });

export const actionNames = (labelOf: (path: string) => string) => () => (tree: Root) => {
  findAndReplace(
    tree,
    [
      [
        NAME,
        (name: string, match: { index: number; input: string }) => {
          // After a word, a slash or a dot it's part of something else, such as an address.
          const before = match.input.charAt(match.index - 1);
          if (before && /[\w/.]/.test(before)) return false;
          const path = actionNamed(name);
          return path ? shown(labelOf(path)) : false;
        },
      ],
    ],
    { ignore: ["link", "linkReference", "inlineCode", "code", "definition"] },
  );
  // A name the model set in code, as it mostly does, is the whole of that code. After the text, so a step's name put in isn't read again.
  const visit = (node: Root | Root["children"][number]) => {
    if (!("children" in node)) return;
    node.children = node.children.map((child) => {
      const path = child.type === "inlineCode" ? actionNamed(child.value.trim()) : undefined;
      return path ? shown(labelOf(path)) : child;
    }) as typeof node.children;
    node.children.forEach(visit);
  };
  visit(tree);
};
