// The rating filter on a search's results, in its own module so Convex functions that read a saved search can
// ask whether it narrows anything without loading lib/utils (tailwind-merge, date-fns, the CSV import).

/** Every rating, as the filter starts. */
export const RATING_RANGE: [number, number] = [0, 5];

/** Whether the rating filter narrows the results: only rated papers asked for, or a narrower range of ratings. Never where `onlyRated` is false. */
export const isRatingFilterActive = (range?: [number, number], onlyRated?: boolean) =>
  onlyRated !== false && (onlyRated === true || (range !== undefined && (range[0] !== RATING_RANGE[0] || range[1] !== RATING_RANGE[1])));
