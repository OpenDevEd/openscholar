"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

// A picture with its fallback under it. The picture is a plain <img>, so the server sends it and
// the browser paints it with the page, from its cache, on the first frame. Radix's Avatar draws
// nothing until the browser has loaded the picture again after the page hydrates, which blanked
// every photo and logo on each load. While a picture is there the fallback keeps its icon to
// itself, and once it has loaded the fallback steps aside; one that fails is dropped, and the
// fallback shows again.

/**
 * For avatars put on the page after it has loaded, as in a step or a row that arrives: put on an element around them,
 * each picture fades in once it has loaded and its fallback keeps out of the way meanwhile, where the two would
 * otherwise change places in one frame. A picture the browser already holds is there from the first frame.
 */
export const AVATARS_FADE_IN =
  "[&_[data-slot=avatar-image]]:opacity-0 [&_[data-slot=avatar-image]]:transition-opacity [&_[data-slot=avatar-image]]:duration-200 motion-reduce:[&_[data-slot=avatar-image]]:transition-none [&_[data-slot=avatar-image][data-loaded]]:opacity-100 [&_[data-slot=avatar]:has(>img)>[data-slot=avatar-fallback]]:hidden"

function Avatar({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"span"> & {
  size?: "default" | "sm" | "lg"
}) {
  return (
    <span
      data-slot="avatar"
      data-size={size}
      className={cn(
        "group/avatar relative flex size-8 shrink-0 overflow-hidden rounded-full select-none data-[size=lg]:size-10 data-[size=sm]:size-6",
        "[&:has(>img)>[data-slot=avatar-fallback]>*]:invisible [&:has(>img[data-loaded])>[data-slot=avatar-fallback]]:hidden",
        className
      )}
      {...props}
    />
  )
}

function AvatarImage({
  className,
  src,
  alt = "",
  ...props
}: Omit<React.ComponentProps<"img">, "src"> & { src?: string }) {
  // Settled for this picture only: another src starts again.
  const [settled, setSettled] = React.useState<{ src: string; loaded: boolean } | null>(null)
  // A picture the browser finished before the page hydrated fired its load event unheard: read it as it mounts.
  const mounted = React.useCallback(
    (img: HTMLImageElement | null) => {
      if (img?.complete && src) setSettled({ src, loaded: img.naturalWidth > 0 })
    },
    [src]
  )
  const state = settled?.src === src ? settled : null
  if (!src || state?.loaded === false) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element -- photos and logos come from Clerk and OpenAlex at their own sizes
    <img
      data-slot="avatar-image"
      data-loaded={state?.loaded ? "" : undefined}
      src={src}
      alt={alt}
      // Decoded with the page and shown with it: a small picture is quicker than a frame of its icon.
      decoding="sync"
      ref={mounted}
      onLoad={() => setSettled({ src, loaded: true })}
      onError={() => setSettled({ src, loaded: false })}
      className={cn("absolute inset-0 aspect-square size-full", className)}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-fallback"
      className={cn(
        "bg-muted text-muted-foreground flex size-full items-center justify-center rounded-full text-sm group-data-[size=sm]/avatar:text-xs",
        className
      )}
      {...props}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback };
