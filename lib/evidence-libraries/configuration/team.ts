/** Up to two initials for an avatar: from the name, else the email, else "?". */
export function initialsOf(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0]![0]}${words[words.length - 1]![0]}`.toUpperCase();
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  const local = email.trim().split("@")[0] ?? "";
  return local ? local.slice(0, 2).toUpperCase() : "?";
}
