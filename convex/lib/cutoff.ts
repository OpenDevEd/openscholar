/**
 * The cutoff a sweep carries across its batches, so it takes the rows that exist now and
 * leaves those made later. A row's creation time carries fractions of a millisecond and
 * `Date.now()` doesn't, so a row made earlier in this millisecond would read as later than
 * now. Everything made before the next millisecond counts: compare with `<`.
 */
export const existingBefore = () => Date.now() + 1;
