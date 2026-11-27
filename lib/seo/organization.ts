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
  sameAs: ["https://www.linkedin.com/company/openscholar/", "https://github.com/OpenDevEd/openscholar", "https://www.instagram.com/openscholar.ai/"],
};
