/**
 * What went wrong with an action, as the model should read it and as its step shows it to
 * the person. Apart from ./tools.ts, so a mutation can word a failure too (./bulk.ts).
 */
import { readConvexErrorData } from "../lib/errors";
import { MODEL_READS } from "./steps";

const cut = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);

/** Convex's words for a write that lost a race with another write, however often it was tried again. */
export const COLLIDED = /changed while this mutation was being run/;
/** What is said of one. It changed nothing, so it can be made again. */
export const COLLISION = "This collided with another change made at the same moment, so it wasn't made. Nothing was changed: try it again.";

/**
 * An error as the model should read it, and as the step shows it to the person: the action's
 * own message. One the action didn't write (a crash, a limit of the runtime) is cut to its
 * first line, without the runtime's prefix and the trace of where it was thrown.
 */
export const messageOf = (error: unknown) => {
  const told = readConvexErrorData(error)?.message;
  if (told) return cut(told, MODEL_READS / 4);
  const raw = error instanceof Error ? error.message : String(error);
  const fit = misfit(raw);
  if (fit) return fit;
  // The runtime's own words for it tell a person nothing they can act on.
  if (COLLIDED.test(raw)) return COLLISION;
  console.error("[assistant] an action failed with an error it didn't write", error);
  return cut(raw.split("\n")[0].replace(/^(?:\[Request ID: \w+\] Server Error\s*)?(?:Uncaught \w*Error: )?/, ""), 300);
};

/**
 * What Convex says of an argument that doesn't fit, as the model can act on it: which
 * argument, what it takes and what it got. Its first line alone, "Value does not match
 * validator", named none of them: given a collection's name where its ID goes, the model
 * was told nothing it could correct. Null for any other error.
 */
export function misfit(text: string) {
  if (!text.includes("ArgumentValidationError")) return null;
  const line = (label: string) => text.match(new RegExp(`^\\s*${label}: (.*)$`, "m"))?.[1]?.trim();
  const [path, value, takes] = [line("Path"), line("Value"), line("Validator")];
  const said = text.split("\n").find((part) => part.includes("ArgumentValidationError"))!.replace(/^.*ArgumentValidationError: /, "");
  // A missing or an unknown field is said whole on the error's own line, which names it. Inside another argument, that one is named too.
  if (!path || !takes || !said.startsWith("Value does not match validator")) return cut(`These arguments don't fit${path ? `, in ${path.replace(/^\./, "")}` : ""}: ${said}`, 400);
  return cut(`The argument ${path.replace(/^\./, "")} doesn't fit: it takes ${takes}${value ? `, and got ${value}` : ""}.${takes.startsWith("v.id(") ? " An ID is one a result gave you, never a name." : ""}`, 400);
}
