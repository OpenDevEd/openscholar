/** The colours an organization can take (#651): its admins pick one in its settings, and until they do, its ID picks one. */
export const ORGANIZATION_COLOURS = ["#d97706", "#ea580c", "#e11d48", "#db2777", "#7c3aed", "#2563eb", "#0d9488", "#16a34a", "#64748b"] as const;
export type OrganizationColour = (typeof ORGANIZATION_COLOURS)[number];
