/** Openscholar's official profiles, by the service each is on: shown on the marketing site and named to search engines. */
export const PROFILES = [
  ["linkedin", "https://www.linkedin.com/company/openscholar/"],
  ["github", "https://github.com/OpenDevEd/openscholar"],
  ["instagram", "https://www.instagram.com/openscholar.ai/"],
] as const;

/**
 * Openscholar as one organisation, the same on the marketing site and the app, so search engines tie the name, both
 * sites and our official profiles together instead of seeing two organisations.
 */
export const ORGANIZATION = {
  "@type": "Organization",
  "@id": "https://openscholar.ai/#org",
  name: "Openscholar",
  url: "https://openscholar.ai/",
  logo: "https://openscholar.ai/apple-touch-icon.png",
  email: "habari@openscholar.ai",
  sameAs: PROFILES.map(([, url]) => url),
};
