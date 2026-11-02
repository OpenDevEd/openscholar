import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://openscholar.ai",
  compressHTML: true,
  // Every page's CSS ships inside the page, so nothing blocks the first paint.
  build: { inlineStylesheets: "always", format: "directory" },
  devToolbar: { enabled: false },
});
