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

// Links are text in the brand colour, so they take its readable stop.
const link = { color: "var(--primary-ink)" };
const elements = { footerActionLink: link, formFieldAction: link, formResendCodeLink: link, identityPreviewEditButton: link } satisfies NonNullable<Appearance["elements"]>;

export function resolveClerkAppearance(
  resolvedTheme: string | null | undefined,
): Appearance {
  // The mark for white and for black. Sign-up keeps
  // offering the optional first and last name, which other members see.
  return resolvedTheme === "dark"
    ? { theme: dark, variables, elements, options: { logoImageUrl: "/icon-black.svg", showOptionalFields: true } }
    : { variables, elements, options: { logoImageUrl: "/icon.svg", showOptionalFields: true } };
}
