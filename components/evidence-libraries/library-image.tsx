"use client";

import type { ReactNode } from "react";
import { useState } from "react";

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
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <div className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element -- owner-hosted image, any domain */}
      <img src={src} alt="" className={imageClassName} data-library-image onError={() => setFailed(true)} />
    </div>
  );
}
