"use client";

import { preload } from "react-dom";
import { FadeImage } from "@/components/ui/fade-image";

const SRC = "/brands/zenodo-icon.png";

/** Fetches Zenodo's mark with the page, so it is there when a part that shows it opens. */
export const preloadZenodoMark = () => preload(SRC, { as: "image" });

/** Zenodo's own mark, its app icon (zenodo.org/static/apple-touch-icon-180.png), fading in once it has loaded. */
export function ZenodoMark({ className }: { className: string }) {
  preloadZenodoMark();
  return <FadeImage src={SRC} className={className} />;
}
