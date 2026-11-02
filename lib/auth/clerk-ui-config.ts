import { dark } from "@clerk/ui/themes";
import type { Appearance } from "@clerk/ui";

// Clerk's own screens take their colours and typeface from the app's tokens,
// so they follow the active theme.
const variables = {
  colorPrimary: "var(--primary)",
  colorPrimaryForeground: "var(--primary-foreground)",
  colorBackground: "var(--card)",
  colorForeground: "var(--foreground)",
  colorMutedForeground: "var(--muted-foreground)",
  colorInput: "var(--background)",
  colorInputForeground: "var(--foreground)",
  colorNeutral: "var(--foreground)",
  colorDanger: "var(--destructive)",
  fontFamily: "var(--font-sans)",
} satisfies NonNullable<Appearance["variables"]>;

export function resolveClerkAppearance(
  resolvedTheme: string | null | undefined,
): Appearance {
  // The mark as the brand guidelines draw it on white and on black. Sign-up keeps
  // offering the optional first and last name, which other members see.
  return resolvedTheme === "dark"
    ? { theme: dark, variables, options: { logoImageUrl: "/icon-black.svg", showOptionalFields: true } }
    : { variables, options: { logoImageUrl: "/icon.svg", showOptionalFields: true } };
}
