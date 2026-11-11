import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A translation that renames a placeholder ({organization} spelt {organisation}, say) fails to format, and the page
// shows the message's key instead. A translation may leave an argument out (a language without plurals drops the
// count), but uses none the English message isn't given.
const dir = join(__dirname, "..", "messages");
type Tree = { [key: string]: string | Tree };
const flat = (tree: Tree, prefix = ""): Array<[string, string]> => Object.entries(tree).flatMap(([key, value]) => (typeof value === "string" ? [[prefix + key, value] as [string, string]] : flat(value, `${prefix}${key}.`)));
/**
 * The arguments a message takes, read as ICU does: `{name}`, `{count, plural, one {…} other {…}}` and
 * `{kind, select, …}`, whose branches are messages of their own; their words aren't arguments.
 */
function argumentsOf(message: string) {
  const found = new Set<string>();
  /** Reads a message from `at` up to an unmatched `}`, answering where it stopped. */
  const read = (at: number): number => {
    while (at < message.length && message[at] !== "}") {
      if (message[at] !== "{") {
        at++;
        continue;
      }
      const head = /^\{\s*([A-Za-z_]\w*)\s*(?:,\s*(\w+)\s*(?:,)?)?/.exec(message.slice(at))!;
      found.add(head[1]);
      at += head[0].length;
      if (head[2] === "plural" || head[2] === "select" || head[2] === "selectordinal") {
        // Branches: a key, then its message in braces, until the argument's own closing brace.
        while (message[at] !== "}") {
          const open = message.indexOf("{", at);
          at = read(open + 1) + 1;
          while (/\s/.test(message[at] ?? "")) at++;
        }
      } else {
        while (message[at] !== "}") at++;
      }
      at++;
    }
    return at;
  };
  read(0);
  return [...found].sort();
}
const english = new Map(flat(JSON.parse(readFileSync(join(dir, "en-US.json"), "utf8"))));

describe("translated messages", () => {
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json") && name !== "en-US.json")) {
    it(`use only English's arguments in ${file}`, () => {
      const wrong = flat(JSON.parse(readFileSync(join(dir, file), "utf8"))).flatMap(([key, message]) => {
        if (!english.has(key)) return [];
        const given = argumentsOf(english.get(key)!);
        const unknown = argumentsOf(message).filter((name) => !given.includes(name));
        return unknown.length ? [`${key}: {${unknown.join("}, {")}} in "${message}"`] : [];
      });
      expect(wrong).toEqual([]);
    });
  }
});
