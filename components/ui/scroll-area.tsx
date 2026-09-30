"use client"

import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/** How far content fades at an edge that has more to scroll; the same fade as the assistant's thread. */
export const EDGE_FADE = 18

function ScrollArea({
  className,
  children,
  shades = false,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  /** Fades the content out at an edge that has more to scroll. */
  shades?: boolean
}) {
  const viewport = React.useRef<HTMLDivElement>(null)
  const content = React.useRef<HTMLDivElement>(null)
  const [edges, setEdges] = React.useState({ top: false, bottom: false })
  const measure = React.useCallback(() => {
    const el = viewport.current
    if (!el) return
    const top = el.scrollTop > 1
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1
    setEdges((e) => (e.top === top && e.bottom === bottom ? e : { top, bottom }))
  }, [])
  // The content's size is an outside system: rows arrive, filters change it, the window resizes.
  React.useEffect(() => {
    if (!shades) return
    const observer = new ResizeObserver(measure)
    if (viewport.current) observer.observe(viewport.current)
    if (content.current) observer.observe(content.current)
    measure()
    return () => observer.disconnect()
  }, [shades, measure])
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewport}
        data-slot="scroll-area-viewport"
        onScroll={shades ? measure : undefined}
        style={
          shades
            ? {
                maskImage: `linear-gradient(to bottom, transparent, black ${edges.top ? EDGE_FADE : 0}px, black calc(100% - ${edges.bottom ? EDGE_FADE : 0}px), transparent)`,
              }
            : undefined
        }
        className={cn(
          "focus-visible:ring-ring/50 size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1",
          // Radix lays its content out as a table, which lets long text grow instead of truncating.
          shades && "[&>div]:!block"
        )}
      >
        {shades ? <div ref={content}>{children}</div> : children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors select-none",
        orientation === "vertical" &&
          "h-full w-2.5 border-l border-l-transparent",
        orientation === "horizontal" &&
          "h-2.5 flex-col border-t border-t-transparent",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="bg-border relative flex-1 rounded-full"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
