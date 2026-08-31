type OperationError = {
  code?: string;
  message?: string;
};

export function namesHostingProvider(error: OperationError): boolean {
  return (
    error.code?.startsWith("COOLIFY_") === true ||
    /coolify/i.test(error.message ?? "")
  );
}

/** Keep infrastructure details in operation records, not in owner-facing copy. */
export function publicOperationErrorMessage(
  error: OperationError | null | undefined,
  hostingFallback: string,
): string | undefined {
  if (!error?.message) return undefined;
  return namesHostingProvider(error) ? hostingFallback : error.message;
}

export function publicOperationIssueMessages(
  issues: readonly OperationError[] | null | undefined,
  hostingFallback: string,
): string[] | undefined {
  if (!issues) return undefined;
  return [
    ...new Set(
      issues
        .map((issue) => publicOperationErrorMessage(issue, hostingFallback))
        .filter((message): message is string => message !== undefined),
    ),
  ];
}
