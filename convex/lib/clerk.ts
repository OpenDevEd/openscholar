// Clerk's Backend API, with plain fetch and no Convex imports, so any action can call it.

const CLERK_API = "https://api.clerk.com/v1";
const REQUEST_TIMEOUT_MS = 15_000;

export class ClerkApiError extends Error {
  constructor(
    message: string,
    /** Clerk's HTTP status, or undefined when Clerk could not be reached. */
    readonly status: number | undefined,
    readonly code: string | undefined,
    readonly traceId: string | undefined,
  ) {
    super(message);
    this.name = "ClerkApiError";
  }

  /** Worth trying again later: Clerk was unreachable or failed on its side. */
  get retryable() {
    return this.status === undefined || this.status === 429 || this.status >= 500;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function clerkRequest(
  secretKey: string,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  // A form (a file upload) sets its own content type.
  const form = body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`${CLERK_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        ...(body === undefined || form ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ClerkApiError(
      `Clerk could not be reached: ${error instanceof Error ? error.message : String(error)}`,
      undefined,
      undefined,
      undefined,
    );
  }
  const parsed: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const firstError =
      isRecord(parsed) && Array.isArray(parsed.errors) && isRecord(parsed.errors[0])
        ? parsed.errors[0]
        : null;
    throw new ClerkApiError(
      `Clerk answered ${response.status} to ${method} ${path.split("?")[0]}`,
      response.status,
      typeof firstError?.code === "string" ? firstError.code : undefined,
      isRecord(parsed) && typeof parsed.clerk_trace_id === "string" ? parsed.clerk_trace_id : undefined,
    );
  }
  return { status: response.status, body: parsed };
}

/** The deployment's Clerk secret key, read when a call needs it. */
export function clerkSecretKey() {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error("CLERK_SECRET_KEY is not set");
  return key;
}
