"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * An image the server sent can fail before the page's code runs, when nothing is listening for its error yet.
 * The browser only tells a later listener if asked again, so load it once more: `fail` runs if that fails too, and
 * if it works this time the image shows it.
 */
export function noticeEarlyFailure(image: HTMLImageElement | null, fail: () => void) {
  if (!image?.complete || image.naturalWidth > 0) return;
  const url = image.src;
  const again = new Image();
  again.onerror = fail;
  // Only if it still shows this address: a replacement icon may have come while this one was asked for.
  again.onload = () => { if (image.src === url) image.src = url; };
  again.src = url;
}

/**
 * A library's own image (its favicon) in a tile. Owners host these anywhere,
 * so when the file fails to load the tile shows the fallback instead.
 */
export function LibraryImage({
  src,
  className,
  imageClassName,
  fallback,
  fadeIn = false,
}: {
  src: string;
  className: string;
  imageClassName: string;
  fallback: ReactNode;
  /** Fades the image in once it loads, for a tile drawn after the page, such as in a popover. */
  fadeIn?: boolean;
}) {
  // Remember which URL failed, so a replacement favicon still gets its chance.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  if (failedSrc === src) return <>{fallback}</>;
  return (
    <div className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element -- owner-hosted image, any domain */}
      <img
        ref={(image) => {
          noticeEarlyFailure(image, () => setFailedSrc(src));
          if (fadeIn && image?.complete && image.naturalWidth > 0) setLoadedSrc(src);
        }}
        src={src}
        alt=""
        className={fadeIn ? cn(imageClassName, "transition-opacity duration-200", loadedSrc === src ? "opacity-100" : "opacity-0") : imageClassName}
        data-library-image
        onLoad={fadeIn ? () => setLoadedSrc(src) : undefined}
        onError={() => setFailedSrc(src)}
      />
    </div>
  );
}
