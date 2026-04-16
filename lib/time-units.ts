/**
 * Time unit conversion constants.
 *
 * Centralised so that UI surfaces subject to GAP-03 lint (literal 1000/200 ban
 * in extraction UI) can import a named conversion factor instead of repeating
 * the magic number. The extraction-UI rule exists to prevent paper-cap drift;
 * these constants are unit conversions, not caps.
 */
export const MS_PER_SECOND = 1000;
export const SECONDS_PER_MINUTE = 60;
export const MINUTES_PER_HOUR = 60;
export const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE;
export const MS_PER_HOUR = MS_PER_MINUTE * MINUTES_PER_HOUR;
