"use client";

import type { ReactNode } from "react";
import { useState } from "react";

/**
 * An image the server sent can fail before the page's code runs, when nothing is listening for its error yet.
 * The browser only tells a later listener if asked again, so load it once more: `fail` runs if that fails too, and
 * if it works this time the image shows it.
 */
export function noticeEarlyFailure(image: HTMLImageElement | null, fail: () => void) {
  if (!image?.complete || image.naturalWidth > 0) return;
  const url = image.currentSrc || image.src;
  const again = new Image();
  again.onerror = fail;
  again.onload = () => { image.src = url; };
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
}: {
  src: string;
  className: string;
  imageClassName: string;
  fallback: ReactNode;
}) {
  // Remember which URL failed, so a replacement favicon still gets its chance.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src) return <>{fallback}</>;
  return (
    <div className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element -- owner-hosted image, any domain */}
      <img ref={(image) => noticeEarlyFailure(image, () => setFailedSrc(src))} src={src} alt="" className={imageClassName} data-library-image onError={() => setFailedSrc(src)} />
    </div>
  );
}
