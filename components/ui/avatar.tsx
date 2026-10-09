"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

// A picture with its fallback under it. The picture is a plain <img>, so the server sends it and
// the browser paints it with the page, from its cache, on the first frame. Radix's Avatar draws
// nothing until the browser has loaded the picture again after the page hydrates, which blanked
// every photo and logo on each load. The fallback steps aside once the picture has loaded, and
// takes its place if it fails.

type Status = { src: string; status: "loaded" | "error" } | null
const AvatarContext = React.createContext<{ status: Status; setStatus: (status: Status) => void } | null>(null)

function Avatar({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<"span"> & {
  size?: "default" | "sm" | "lg"
}) {
  const [status, setStatus] = React.useState<Status>(null)
  const value = React.useMemo(() => ({ status, setStatus }), [status])
  return (
    <AvatarContext.Provider value={value}>
      <span
        data-slot="avatar"
        data-size={size}
        className={cn(
          // While its picture is on the way, the fallback keeps its icon to itself: a frame of a plain circle, then the picture.
          "group/avatar relative flex size-8 shrink-0 overflow-hidden rounded-full select-none data-[size=lg]:size-10 data-[size=sm]:size-6 [&:has(>img)>[data-slot=avatar-fallback]>*]:invisible",
          className
        )}
        {...props}
      >
        {children}
      </span>
    </AvatarContext.Provider>
  )
}

function AvatarImage({
  className,
  src,
  alt = "",
  ...props
}: Omit<React.ComponentProps<"img">, "src"> & { src?: string }) {
  const avatar = React.useContext(AvatarContext)
  const setStatus = avatar?.setStatus
  // A picture the browser finished before the page hydrated fired its load event unheard: read it as it mounts.
  const settled = React.useCallback(
    (img: HTMLImageElement | null) => {
      if (img?.complete && src) setStatus?.({ src, status: img.naturalWidth > 0 ? "loaded" : "error" })
    },
    [src, setStatus]
  )
  if (!src || (avatar?.status?.src === src && avatar.status.status === "error")) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element -- photos and logos come from Clerk and OpenAlex at their own sizes
    <img
      data-slot="avatar-image"
      src={src}
      alt={alt}
      // Decoded with the page and shown with it: a small picture is quicker than a frame of its icon.
      decoding="sync"
      ref={settled}
      onLoad={() => setStatus?.({ src, status: "loaded" })}
      onError={() => setStatus?.({ src, status: "error" })}
      className={cn("absolute inset-0 aspect-square size-full", className)}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<"span">) {
  const avatar = React.useContext(AvatarContext)
  if (avatar?.status?.status === "loaded") return null
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
