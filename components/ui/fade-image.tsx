"use client";

import { useState } from "react";
import { noticeEarlyFailure } from "@/components/evidence-libraries/library-image";
import { cn } from "@/lib/utils";

/** A picture from any site that fades in once it has loaded, in place of appearing in one frame; `fallback` stands in for one that fails. */
export function FadeImage({ src: wanted, className, shown = "opacity-100", fallback }: { src: string; className: string; shown?: string; fallback?: string }) {
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const src = failed === wanted && fallback ? fallback : wanted;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- hosted by its owner, on any domain
    <img
      // A picture already in the browser's cache has loaded before React is listening.
      ref={(image) => {
        if (image?.complete && image.naturalWidth > 0) setLoaded(src);
        else if (failed !== wanted && loaded !== src) noticeEarlyFailure(image, () => setFailed(wanted));
      }}
      src={src}
      alt=""
      onLoad={() => setLoaded(src)}
      onError={() => setFailed(wanted)}
      className={cn(className, "transition-opacity duration-200 motion-reduce:transition-none", loaded === src ? shown : "opacity-0")}
    />
  );
}
