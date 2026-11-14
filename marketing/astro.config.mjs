import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://openscholar.ai",
  compressHTML: true,
  // Every page's CSS ships inside the page, so nothing blocks the first paint.
  build: { inlineStylesheets: "always", format: "directory" },
  devToolbar: { enabled: false },
  // The browsers the CSS is written for: Vite's own default list, which Astro's build replaces with none. With none, the
  // minifier (lightningcss 1.33) folds `animation-timeline` into the `animation` shorthand, which no browser accepts
  // there, so the whole rule is dropped and nothing tied to scrolling moves.
  vite: { build: { cssTarget: ["chrome111", "edge111", "firefox114", "safari16.4", "ios16.4"] } },
});
