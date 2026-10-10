/** The first moment of `now`'s month in UTC: where a member's monthly cap starts again, as Autumn's does (#652). */
export const monthStart = (now: number) => {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
};
