const MACHINE_CREDENTIAL_PATTERN = /^els_[A-Za-z0-9_-]{43}$/;

export function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

export function readBearerCredential(request: Request): string | null {
  const authorization = request.headers.get("Authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  const credential = match?.[1];
  return credential && MACHINE_CREDENTIAL_PATTERN.test(credential)
    ? credential
    : null;
}

