/**
 * How many releases `running` is behind `target`, counted along `newestFirst`. A commit the list
 * doesn't hold is older than all of it, or was never released. Zero when it's level or ahead:
 * updates only go forward.
 */
export function releasesBehind(running: string, target: string, newestFirst: readonly { commit: string }[]) {
  const on = newestFirst.findIndex(({ commit }) => commit === running);
  const to = newestFirst.findIndex(({ commit }) => commit === target);
  if (to === -1) return 0;
  return Math.max(0, (on === -1 ? newestFirst.length : on) - to);
}

/** The newest release a deployment offers: promoted ones, or all of them on shared dev. */
export function newestOffered<Release extends { prerelease: boolean }>(newestFirst: readonly Release[], prereleases: boolean) {
  return newestFirst.find(({ prerelease }) => prereleases || !prerelease) ?? null;
}
