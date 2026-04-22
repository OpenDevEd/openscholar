/**
 * Shared Animation Configurations
 * 
 * Centralized spring configs for consistent animations across the app.
 * Use these instead of defining spring configs inline.
 */

/**
 * Subtle spring for gentle UI transitions (cards, panels, etc)
 */
export const subtleSpring = {
  type: "spring" as const,
  stiffness: 350,
  damping: 30,
  mass: 0.8,
};

/**
 * Command center spring for modal/panel animations
 */
export const commandCenterSpring = {
  type: "spring" as const,
  stiffness: 400,
  damping: 35,
  mass: 0.9,
};

/**
 * Hint enter/exit variants - consistent crossfade for alternating hints
 */
export const hintVariants = {
  enter: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

/**
 * Hint transition - 150-300ms per UI/UX guidelines
 */
export const hintTransition = {
  ...subtleSpring,
  duration: 0.25,
};

/**
 * Mode toggle indicator - snappy, premium slide
 */
export const modeToggleSpring = {
  type: "spring" as const,
  stiffness: 520,
  damping: 32,
  mass: 0.7,
};

/**
 * Submit button icon morph - rotate into blur, snappy
 */
export const submitButtonMorphTransition = {
  type: "spring" as const,
  stiffness: 480,
  damping: 30,
};

export const submitButtonIconVariants = {
  enter: { rotate: -15, filter: "blur(3px)", opacity: 0 },
  animate: { rotate: 0, filter: "blur(0px)", opacity: 1 },
  exit: { rotate: 15, filter: "blur(3px)", opacity: 0 },
};

export const submitButtonTextVariants = {
  enter: { y: 4, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  exit: { y: -4, opacity: 0 },
};

/**
 * Card entrance animation — slide-up fade for panels, cards, and sections.
 * Used across extraction surfaces and anywhere cards enter the viewport.
 */
export const cardEntrance = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
} as const;

/**
 * Card entrance transition with optional stagger delay.
 * Easing curve tuned for a natural deceleration feel.
 */
export const cardEntranceTransition = (delay = 0) => ({
  duration: 0.35,
  delay,
  ease: [0.25, 0.46, 0.45, 0.94] as const,
});
