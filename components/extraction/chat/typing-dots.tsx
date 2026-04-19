"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * Pre-first-token loading indicator. Shown the moment a user submit
 * fires until the first streamed chunk arrives — covers the gap
 * (frequently 200-2000ms) where users assume the request silently
 * failed. Three dots fading sequentially is the universally
 * recognised "the AI is preparing" signal.
 */
export function TypingDots() {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return (
      <span
        role="status"
        aria-live="polite"
        aria-label="Generating response"
        data-testid="typing-dots"
        className="inline-flex items-center gap-1 text-muted-foreground"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
      </span>
    );
  }

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label="Generating response"
      data-testid="typing-dots"
      className="inline-flex items-center gap-1 text-muted-foreground"
    >
      {[0, 0.18, 0.36].map((delay, i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-current"
          initial={{ opacity: 0.25, y: 0 }}
          animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
          transition={{
            duration: 0.9,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
            delay,
          }}
        />
      ))}
    </span>
  );
}
