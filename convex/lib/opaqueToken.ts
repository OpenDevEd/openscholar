"use node";

import { randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;

export function generateOpaqueToken(prefix: string): string {
  return `${prefix}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
}
