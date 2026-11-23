/**
 * A remark plugin for replies: an action's own name the model wrote, such as `extraction/start:extract` or
 * research_papers_search, shows as the name its step has in the chat, "Start an extraction". The instructions say
 * never to name them, and Claude Haiku 5.5 on the Cheap preset did anyway. Unknown names, and names inside a code
 * block, are left as they are.
 */
import type { Emphasis, Root } from "mdast";
import { findAndReplace } from "mdast-util-find-and-replace";
import type { useTranslations } from "next-intl";
import { actionNamed, viewOf } from "@/lib/assistant/actions";

/** What an action's name looks like, whole: a path with its colon, or a tool's name with its underscores. A colon after it ends it, as in
 * "change_papers: makes one change…"; one that goes on into a word makes it part of something longer. */
const NAME = /(?:[A-Za-z][A-Za-z0-9]*(?:\/[A-Za-z][A-Za-z0-9]*)*:[A-Za-z][A-Za-z0-9]*|[a-z][a-z0-9]*(?:_[A-Za-z][A-Za-z0-9]*)+)(?![\w/]|:\w)/g;

const shown = (label: string): Emphasis => ({ type: "emphasis", children: [{ type: "text", value: label }] });

/** The names the assistant's own tools, which aren't actions (convex/assistant/tools.ts), have in the chat. */
const OWN_TOOLS = new Map<string, "ownTools.findAction" | "ownTools.runMany" | "ownTools.changePapers" | "steps.other.ask">([
  ["find_action", "ownTools.findAction"],
  ["run_action", "steps.other.ask"],
  ["run_many", "ownTools.runMany"],
  ["change_papers", "ownTools.changePapers"],
]);

/** The action a name the model wrote is, by its path or its tool's name, or the name of one of the assistant's own tools. */
const named = (name: string) => actionNamed(name) ?? (OWN_TOOLS.has(name) ? name : undefined);

/** The action a name found at `index` of `input` is; none after a word, a slash or a dot, where it's part of something else, such as an address. */
const actionAt = (name: string, input: string, index: number) => (index > 0 && /[\w/.]/.test(input.charAt(index - 1)) ? undefined : named(name));

/** The name an action's step has in the chat, such as "Start an extraction", or the name of one of the assistant's own tools. */
export const stepNameOf = (t: ReturnType<typeof useTranslations<"assistant">>) => (path: string) => {
  const own = OWN_TOOLS.get(path);
  if (own) return t(own);
  const { words } = viewOf(path);
  const ask = `steps.${words}.ask` as "steps.other.ask";
  return t(t.has(ask) ? ask : (`steps.${words}.did` as "steps.other.did"));
};

/** Plain text, such as a chat's preview in the list of chats, with each action's own name shown as its step's. */
export const withStepNames = (text: string, labelOf: (path: string) => string) =>
  text.replace(NAME, (name: string, index: number) => {
    const path = actionAt(name, text, index);
    return path ? labelOf(path) : name;
  });

export const actionNames = (labelOf: (path: string) => string) => () => (tree: Root) => {
  findAndReplace(
    tree,
    [
      [
        NAME,
        (name: string, match: { index: number; input: string }) => {
          const path = actionAt(name, match.input, match.index);
          return path ? shown(labelOf(path)) : false;
        },
      ],
    ],
    { ignore: ["link", "linkReference", "inlineCode", "code", "definition"] },
  );
  // The model mostly sets a name in code: code that is only the name becomes the step's name, and a name inside longer
  // code, such as `extraction/start:extract({})`, is swapped for it there. After the text, so a step's name put in isn't read again.
  const visit = (node: Root | Root["children"][number]) => {
    if (!("children" in node)) return;
    node.children = node.children.map((child) => {
      if (child.type !== "inlineCode") return child;
      const path = named(child.value.trim());
      if (path) return shown(labelOf(path));
      return { ...child, value: child.value.replace(NAME, (name: string, index: number) => { const inner = actionAt(name, child.value, index); return inner ? labelOf(inner) : name; }) };
    }) as typeof node.children;
    node.children.forEach(visit);
  };
  visit(tree);
};
