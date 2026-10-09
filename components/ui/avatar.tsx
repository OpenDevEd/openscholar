"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

// A picture with its fallback under it. The picture is a plain <img>, so the server sends it and
// the browser paints it with the page, from its cache, on the first frame. Radix's Avatar draws
// nothing until the browser has loaded the picture again after the page hydrates, which blanked
// every photo and logo on each load. While a picture is there the fallback keeps its icon to
// itself, and once it has loaded the fallback steps aside; one that fails is dropped, and the
// fallback shows again.

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

function AvatarBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        "bg-primary text-primary-foreground ring-background absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full ring-2 select-none",
        "group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden",
        "group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2",
        "group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        "*:data-[slot=avatar]:ring-background group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroupCount({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        "bg-muted text-muted-foreground ring-background relative flex size-8 shrink-0 items-center justify-center rounded-full text-sm ring-2 group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3",
        className
      )}
      {...props}
    />
  )
}

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarBadge,
  AvatarGroup,
  AvatarGroupCount,
}
