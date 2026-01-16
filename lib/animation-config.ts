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
