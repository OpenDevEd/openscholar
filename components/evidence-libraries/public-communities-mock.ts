/**
 * MOCK: sample public communities for the Communities page mock. No query lists public
 * communities yet; the real one reads every active community whose visibility is public,
 * with its record count from the community's own `/api/v1/openscholar/library`.
 */

export type PublicCommunity = {
  id: string;
  name: string;
  tagline: string;
  owner: { name: string; kind: "person" | "organization" };
  address: string;
  accentColor: string;
  faviconUrl: string;
  records: number;
  countries: string[];
  /** When it went live, for the Newest sort. */
  liveAt: number;
};

/** A favicon as an owner would upload one: a glyph on a tile of its own colour. */
const favicon = (tile: string, glyph: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${tile}"/><circle cx="50" cy="12" r="24" fill="#fff" opacity=".22"/><g fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${glyph}</g></svg>`)}`;

const GLYPHS = {
  book: `<path d="M14 18c6-3 12-3 18 1v28c-6-4-12-4-18-1z"/><path d="M50 18c-6-3-12-3-18 1v28c6-4 12-4 18-1z"/>`,
  leaf: `<path d="M18 46C18 28 30 16 48 16c0 18-12 30-30 30z"/><path d="M18 46l16-16"/>`,
  globe: `<circle cx="32" cy="32" r="16"/><path d="M16 32h32"/><path d="M32 16c-6 5-6 27 0 32"/><path d="M32 16c6 5 6 27 0 32"/>`,
  drop: `<path d="M32 14c8 10 14 17 14 24a14 14 0 0 1-28 0c0-7 6-14 14-24z"/>`,
  cap: `<path d="M10 26l22-10 22 10-22 10z"/><path d="M20 31v9c7 5 17 5 24 0v-9"/>`,
  bars: `<path d="M18 46V32"/><path d="M28 46V22"/><path d="M38 46V28"/><path d="M48 46V16"/>`,
  compass: `<circle cx="32" cy="32" r="16"/><path d="M38 26l-4 10-10 4 4-10z"/>`,
  pulse: `<path d="M12 34h10l5-12 8 22 5-10h12"/>`,
  sprout: `<path d="M32 48V28"/><path d="M32 30c0-8-6-12-14-12 0 8 6 12 14 12z"/><path d="M32 34c0-8 6-12 14-12 0 8-6 12-14 12z"/>`,
  wave: `<path d="M12 28c5-5 10-5 15 0s10 5 15 0 10-5 10-5"/><path d="M12 40c5-5 10-5 15 0s10 5 15 0 10-5 10-5"/>`,
};

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 7);

export const PUBLIC_COMMUNITIES: PublicCommunity[] = [
  { id: "p1", name: "Foundational Learning Evidence", tagline: "Studies on literacy and numeracy in the early grades, screened and coded by a team of reviewers.", owner: { name: "Global Learning Lab", kind: "organization" }, address: "foundational-learning.openscholar.ai", accentColor: "#2563eb", faviconUrl: favicon("#1d4ed8", GLYPHS.book), records: 18_420, countries: ["ke", "tz", "ug"], liveAt: NOW - 220 * DAY },
  { id: "p2", name: "Climate Adaptation in Agriculture", tagline: "What works for smallholder farmers facing drought, floods and heat.", owner: { name: "Coastal Resilience Network", kind: "organization" }, address: "climate-adaptation.openscholar.ai", accentColor: "#16a34a", faviconUrl: favicon("#15803d", GLYPHS.leaf), records: 9_310, countries: ["et", "bd", "ng"], liveAt: NOW - 40 * DAY },
  { id: "p3", name: "AI in Education", tagline: "Research on artificial intelligence in classrooms, tutoring and assessment.", owner: { name: "EdTech Research Hub", kind: "organization" }, address: "aied.openscholar.ai", accentColor: "#7c3aed", faviconUrl: favicon("#6d28d9", GLYPHS.cap), records: 41_870, countries: [], liveAt: NOW - 310 * DAY },
  { id: "p4", name: "Water and Sanitation", tagline: "Rigorous evaluations of water, sanitation and hygiene programmes.", owner: { name: "Amina Okafor", kind: "person" }, address: "wash-evidence.openscholar.ai", accentColor: "#0891b2", faviconUrl: favicon("#0e7490", GLYPHS.drop), records: 5_120, countries: ["in", "pk"], liveAt: NOW - 12 * DAY },
  { id: "p5", name: "Education Finance", tagline: "How money reaches schools, and what it buys.", owner: { name: "Policy Evidence Unit", kind: "organization" }, address: "edfinance.openscholar.ai", accentColor: "#ca8a04", faviconUrl: favicon("#a16207", GLYPHS.bars), records: 2_904, countries: ["gh", "sn", "rw"], liveAt: NOW - 95 * DAY },
  { id: "p6", name: "TVET Systems", tagline: "Technical and vocational education and training, from apprenticeships to national qualifications.", owner: { name: "Skills Futures Collaborative", kind: "organization" }, address: "tvet.openscholar.ai", accentColor: "#ea580c", faviconUrl: favicon("#c2410c", GLYPHS.compass), records: 12_660, countries: ["za", "zm"], liveAt: NOW - 150 * DAY },
  { id: "p7", name: "Maternal and Child Health", tagline: "Trials and systematic reviews on care before, during and after birth.", owner: { name: "Health Systems Collective", kind: "organization" }, address: "mch-evidence.openscholar.ai", accentColor: "#db2777", faviconUrl: favicon("#be185d", GLYPHS.pulse), records: 23_015, countries: ["mw", "mz", "zw"], liveAt: NOW - 60 * DAY },
  { id: "p8", name: "Early Childhood Development", tagline: "Parenting, preschool and nutrition programmes for children under five.", owner: { name: "Samuel Mensah", kind: "person" }, address: "ecd.openscholar.ai", accentColor: "#65a30d", faviconUrl: favicon("#4d7c0f", GLYPHS.sprout), records: 7_448, countries: ["gh"], liveAt: NOW - 8 * DAY },
  { id: "p9", name: "Coastal Fisheries", tagline: "Evidence on livelihoods, conservation and management of small-scale fisheries.", owner: { name: "Coastal Resilience Network", kind: "organization" }, address: "fisheries.openscholar.ai", accentColor: "#0284c7", faviconUrl: favicon("#0369a1", GLYPHS.wave), records: 3_377, countries: ["ph", "id", "mg"], liveAt: NOW - 180 * DAY },
  { id: "p10", name: "Wealth Inequality", tagline: "Research on how wealth is distributed, taxed and passed on.", owner: { name: "Policy Evidence Unit", kind: "organization" }, address: "wealth-inequality.openscholar.ai", accentColor: "#475569", faviconUrl: favicon("#334155", GLYPHS.bars), records: 15_902, countries: [], liveAt: NOW - 25 * DAY },
  { id: "p11", name: "Teacher Professional Development", tagline: "Coaching, training and support for teachers, with costs where studies report them.", owner: { name: "Global Learning Lab", kind: "organization" }, address: "teacher-pd.openscholar.ai", accentColor: "#4f46e5", faviconUrl: favicon("#4338ca", GLYPHS.book), records: 6_731, countries: ["ke", "in"], liveAt: NOW - 3 * DAY },
  { id: "p12", name: "Urban Mobility", tagline: "Transport, roads and how people move around fast-growing cities.", owner: { name: "Leila Haddad", kind: "person" }, address: "urban-mobility.openscholar.ai", accentColor: "#e11d48", faviconUrl: favicon("#be123c", GLYPHS.compass), records: 1_208, countries: ["eg", "ma"], liveAt: NOW - 70 * DAY },
  { id: "p13", name: "Refugee Education", tagline: "Schooling for displaced children and the communities that host them.", owner: { name: "EdTech Research Hub", kind: "organization" }, address: "refugee-education.openscholar.ai", accentColor: "#9333ea", faviconUrl: favicon("#7e22ce", GLYPHS.globe), records: 4_486, countries: ["jo", "lb", "ug"], liveAt: NOW - 130 * DAY },
  { id: "p14", name: "Digital Public Goods", tagline: "Open software, open data and open standards for development.", owner: { name: "Skills Futures Collaborative", kind: "organization" }, address: "dpg.openscholar.ai", accentColor: "#0d9488", faviconUrl: favicon("#0f766e", GLYPHS.globe), records: 980, countries: [], liveAt: NOW - 18 * DAY },
];
