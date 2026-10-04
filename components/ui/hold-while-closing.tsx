"use client"

import { createContext, use, useState, type ReactNode } from "react"

// Whether the nearest popover, dialog, sheet or menu is open. Content outside
// one of them counts as open, so it is drawn as given.
const OpenContext = createContext(true)

type OpenProps = { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void }

/**
 * Wraps the root of something that opens and closes, so its content can tell
 * which it is. `children` gets the `open` and `onOpenChange` to hand to the
 * root: the root is always told its state from here, so this hears of a close
 * in the same moment the root does, whoever holds the state.
 */
export function TrackOpen({ open, defaultOpen = false, onOpenChange, children }: OpenProps & { children: (root: Required<Pick<OpenProps, "open" | "onOpenChange">>) => ReactNode }) {
  const [own, setOwn] = useState(defaultOpen)
  const isOpen = open ?? own
  return (
    <OpenContext value={isOpen}>
      {children({
        open: isOpen,
        onOpenChange: (next) => {
          setOwn(next)
          onOpenChange?.(next)
        },
      })}
    </OpenContext>
  )
}

/**
 * Whether the overlay this content belongs to is closing. Content that is held
 * while it closes still has the handlers it had while open, so it is made inert:
 * a second click on a confirm button must not run the action again.
 */
export function useClosing() {
  return !use(OpenContext)
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
