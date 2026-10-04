"use client"

import { createContext, use, useState, type ReactNode } from "react"

// Whether the nearest popover, dialog, sheet or menu is open. Content outside
// one of them counts as open, so it is drawn as given.
const OpenContext = createContext(true)

type OpenProps = { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void }

/**
 * Wraps the root of something that opens and closes, so its content can tell
 * which it is. It follows the root whether the caller holds the open state or
 * the root does; `children` gets the `onOpenChange` to hand to the root.
 */
export function TrackOpen({ open, defaultOpen = false, onOpenChange, children }: OpenProps & { children: (onOpenChange: (open: boolean) => void) => ReactNode }) {
  const [own, setOwn] = useState(defaultOpen)
  return (
    <OpenContext value={open ?? own}>
      {children((next) => {
        setOwn(next)
        onOpenChange?.(next)
      })}
    </OpenContext>
  )
}

/**
 * Keeps what was shown when closing began. The state behind a popover or
 * dialog is often cleared the moment it closes, and without this its closing
 * animation would play over an empty or half-empty shell.
 */
export function HoldWhileClosing({ children }: { children: ReactNode }) {
  const open = use(OpenContext)
  const [held, setHeld] = useState(children)
  if (open && held !== children) setHeld(children)
  return open ? children : held
}
