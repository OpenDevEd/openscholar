/**
 * A remark plugin for replies: a record's address the model wrote as text, not as the link its
 * instructions ask for, becomes a link named by the kind of record it is, so it shows as that
 * record's chip (./panel.tsx ReplyLink). It reads the parsed reply, so an address already in a
 * link or an autolink, or in code of any kind, is left as it is.
 */
import type { Link, Root } from "mdast";
import { findAndReplace } from "mdast-util-find-and-replace";
import { recordOf, type LinkedRecord } from "@/lib/assistant/view";

/** An address of one of the app's record pages, whole: its path and parameters, short of a closing bracket or the sentence's last mark. */
const ADDRESS = /\/(?:results\/|library\?|extraction\/|screening\?|evidence-(?:communities|libraries)\/|topics\/|\?chat=)[^\s<>()[\]{}"'`]*[^\s<>()[\]{}"'`.,;:!?]/g;

export const recordLinks = (nameOf: (kind: LinkedRecord["kind"]) => string) => () => (tree: Root) => {
  findAndReplace(
    tree,
    [
      [
        ADDRESS,
        (address: string, match: { index: number; input: string }): Link | false => {
          // After a word or a slash it's the end of some other address.
          const before = match.input.charAt(match.index - 1);
          if (before && /[\w/.#\-]/.test(before)) return false;
          const record = recordOf(address);
          return record && !record.paperId ? { type: "link", url: address, children: [{ type: "text", value: nameOf(record.kind) }] } : false;
        },
      ],
    ],
    { ignore: ["link", "linkReference", "inlineCode", "code", "definition"] },
  );
};
