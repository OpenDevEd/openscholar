/**
 * Up to two letters for a tile or avatar: first letters of the first two
 * words of the name. With no name, the first two letters of the email's local
 * part; with neither, an empty string.
 */
export function initialsOf(name: string, email = ""): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    return words
      .slice(0, 2)
      .map((word) => Array.from(word)[0] ?? "")
      .join("")
      .toUpperCase();
  }
  const local = email.trim().split("@")[0] ?? "";
  return Array.from(local).slice(0, 2).join("").toUpperCase();
}
