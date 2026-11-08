"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** A picture from any site that fades in once it has loaded, in place of appearing in one frame. */
export function FadeImage({ src, className, shown = "opacity-100" }: { src: string; className: string; shown?: string }) {
  const [loaded, setLoaded] = useState<string | null>(null);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- hosted by its owner, on any domain
    <img
      // A picture already in the browser's cache has loaded before React is listening.
      ref={(image) => { if (image?.complete && image.naturalWidth > 0) setLoaded(src); }}
      src={src}
      alt=""
      onLoad={() => setLoaded(src)}
      className={cn(className, "transition-opacity duration-200 motion-reduce:transition-none", loaded === src ? shown : "opacity-0")}
    />
  );
}
