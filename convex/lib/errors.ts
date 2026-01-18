import { ConvexError } from "convex/values";

export type ErrorCode = 
  | "UNAUTHENTICATED"
  | "FORBIDDEN" 
  | "NOT_FOUND"
  | "INSUFFICIENT_CREDITS"
  | "VALIDATION_ERROR"
  | "STRIPE_ERROR";

export function createError(code: ErrorCode, message: string): ConvexError<{ code: ErrorCode; message: string }> {
  return new ConvexError({ code, message });
}
