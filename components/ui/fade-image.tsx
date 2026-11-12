"use client";

import Image from "next/image";
import { useState, type SyntheticEvent } from "react";
import { noticeEarlyFailure } from "@/components/evidence-libraries/library-image";
import { cn } from "@/lib/utils";

/**
 * A picture from any site that fades in once it has loaded, in place of appearing in one frame; `fallback` stands in for
 * one that fails. Given `sizes`, it's one next.config.ts lets the server resize, filling its positioned parent.
 */
export function FadeImage({ src: wanted, className, shown = "opacity-100", fallback, sizes, onShape, onFailed }: {
  src: string;
  className: string;
  shown?: string;
  fallback?: string;
  sizes?: string;
  /** Told the picture's width over its height once it has loaded, for a frame that takes the picture's shape. */
  onShape?: (shape: number) => void;
  /** Told when the picture can't be loaded and has no `fallback`, for a caller that shows something else. */
  onFailed?: () => void;
}) {
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const src = failed === wanted && fallback ? fallback : wanted;
  const shaped = (image: HTMLImageElement) => image.naturalHeight > 0 && onShape?.(image.naturalWidth / image.naturalHeight);
  const fail = () => {
    setFailed(wanted);
    if (!fallback) onFailed?.();
  };
  const props = {
    // A picture already in the browser's cache has loaded before React is listening.
    ref: (image: HTMLImageElement | null) => {
      if (image?.complete && image.naturalWidth > 0) {
        setLoaded(src);
        shaped(image);
      } else if (failed !== wanted && loaded !== src) noticeEarlyFailure(image, fail);
    },
    src,
    alt: "",
    onLoad: (event: SyntheticEvent<HTMLImageElement>) => {
      setLoaded(src);
      shaped(event.currentTarget);
    },
    onError: fail,
    className: cn(className, "transition-opacity duration-200 motion-reduce:transition-none", loaded === src ? shown : "opacity-0"),
  };
  if (sizes) return <Image {...props} fill sizes={sizes} />;
  // eslint-disable-next-line @next/next/no-img-element -- hosted by its owner, on any domain
  return <img {...props} />;
}
