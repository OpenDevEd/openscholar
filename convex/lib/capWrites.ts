/**
 * Enforces the list caps (./listCaps.ts) on every write (#426). It checks the value a write
 * sets, before the write: the whole row for an insert or replace, only the set fields for a
 * patch. So it reads nothing, and a row saved before its cap existed can still be patched.
 * `./functions.ts` applies it to every mutation; `t.run` applies it in tests.
 */
import type { GenericDatabaseWriter } from "convex/server";
import type { GenericId } from "convex/values";
import type { DataModel, TableNames } from "../_generated/dataModel";
import schema from "../schema";
import { createError } from "./errors";
import { listsIn, overCap, type ListAt } from "./listCaps";

/** Each table's capped lists, worked out once from the schema. */
const capsByTable = new Map<string, ListAt[]>(
  Object.entries(schema.tables)
    .map(([table, definition]) => {
      // Union members repeat paths they share (a section's draft and revision rows): check each once.
      const seen = new Set<string>();
      const lists = listsIn(definition.validator).filter((list) => {
        const key = `${list.path.join(".")}|${list.kind}|${list.cap}`;
        if (list.cap === undefined || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return [table, lists] as const;
    })
    .filter(([, lists]) => lists.length > 0),
);

function check(table: string, value: unknown) {
  const lists = capsByTable.get(table);
  const over = lists && value ? overCap(value, lists) : undefined;
  if (over) throw createError("INVALID_DATA", `${table}.${over.path} holds ${over.size} ${over.unit}; it holds at most ${over.cap}.`, { table, path: over.path, size: over.size, cap: over.cap });
}

/** A database writer that refuses a write putting more in a list than its cap. */
export function capWrites<DB extends GenericDatabaseWriter<DataModel>>(db: DB): DB {
  // A patch or replace given only an ID: the ID says its table, with no read.
  const tableOf = (id: GenericId<TableNames>) => [...capsByTable.keys()].find((table) => db.normalizeId(table as TableNames, id) !== null);
  const wrapped = Object.create(db) as DB;
  const write = (method: "patch" | "replace") =>
    ((...args: unknown[]) => {
      // As Convex dispatches: a third argument means `(table, id, value)`.
      const [table, value] = args[2] !== undefined ? [args[0] as string, args[2]] : [tableOf(args[0] as GenericId<TableNames>), args[1]];
      if (table) check(table, value);
      return (db[method] as (...rest: unknown[]) => unknown)(...args);
    }) as DB[typeof method];
  wrapped.insert = ((table: string, value: unknown) => {
    check(table, value);
    return db.insert(table as TableNames, value as never);
  }) as DB["insert"];
  wrapped.patch = write("patch");
  wrapped.replace = write("replace");
  return wrapped;
}
