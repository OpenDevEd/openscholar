"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({
  onFocus,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      onFocus={keyboardFocusOnly(onFocus)}
      {...props}
    />
  )
}

/**
 * Radix opens a hint on any focus, including focus a script moves: a sheet
 * focusing its first button, or a menu giving focus back as it closes. Here
 * only focus that follows a key press opens one. On a touch screen nothing
 * leaves the button to close a hint opened that way, so it stayed up.
 */
function keyboardFocusOnly<T extends Element>(
  onFocus?: React.FocusEventHandler<T>
): React.FocusEventHandler<T> {
  return (event) => {
    onFocus?.(event)
    // Radix skips its own handler once the default is prevented.
    if (!pressedKeyLast) event.preventDefault()
  }
}

// `:focus-visible` can't tell: after a tap, Safari counts a script's focus as
// keyboard focus, because a tap focuses no button. React Aria tracks the last
// input the same way.
let pressedKeyLast = false
if (typeof document !== "undefined") {
  document.addEventListener(
    "keydown",
    (event) => {
      pressedKeyLast = !event.metaKey && !event.ctrlKey && !event.altKey
    },
    true
  )
  document.addEventListener(
    "pointerdown",
    () => {
      pressedKeyLast = false
    },
    true
  )
}

function TooltipContent({
  className,
  arrowClassName,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
  arrowClassName?: string
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "bg-foreground text-background animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit max-w-[min(28rem,calc(100vw-1rem))] origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance [overflow-wrap:anywhere]",
          className
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow
          className={cn(
            "bg-foreground fill-foreground z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]",
            arrowClassName
          )}
        />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

/**
 * The app's hover hint, used instead of the browser's `title`. The wrapper
 * stays when there is no label, so a hint that comes and goes never remounts
 * its trigger. A disabled button fires no pointer events: wrap it in a span.
 * `onlyWhenClipped` opens it only while the trigger or something inside it
 * is cut off, for hints that repeat text to show it in full.
 */
function TooltipHint({
  label,
  onlyWhenClipped = false,
  children,
}: {
  label?: React.ReactNode
  onlyWhenClipped?: boolean
  children: React.ReactElement
}) {
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  return (
    <Tooltip
      open={open}
      onOpenChange={(next) =>
        setOpen(next && (!onlyWhenClipped || isClipped(triggerRef.current)))
      }
    >
      <TooltipTrigger asChild ref={triggerRef}>
        {children}
      </TooltipTrigger>
      {label ? <TooltipContent>{label}</TooltipContent> : null}
    </Tooltip>
  )
}

function isClipped(element: HTMLElement | null) {
  if (!element) return false
  return [element, ...element.querySelectorAll<HTMLElement>("*")].some(
    (node) =>
      node.scrollWidth > node.clientWidth ||
      node.scrollHeight > node.clientHeight
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, TooltipHint, keyboardFocusOnly }
