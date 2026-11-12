/** Kept apart from the migrations, which load the 4 MB generated validator, so a module that only reads it stays light. */
export const CURRENT_OWNER_CONFIGURATION_VERSION = 15 as const;
