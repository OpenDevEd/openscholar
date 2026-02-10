import { createError } from "./errors";

export function requirePublicDebugEnabled() {
  if (process.env.ENABLE_PUBLIC_DEBUG_FUNCTIONS !== "true") {
    throw createError("FORBIDDEN", "Debug functions are disabled");
  }
}
