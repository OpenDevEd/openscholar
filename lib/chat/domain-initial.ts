export function domainInitial(host: string): string {
  const stripped = host.replace(/^www\./i, "");
  const ch = stripped.charAt(0);
  return ch ? ch.toUpperCase() : "?";
}
