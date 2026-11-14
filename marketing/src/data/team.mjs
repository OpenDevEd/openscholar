// The people behind Openscholar and where they work. Everything here is already public: names, roles, bios and publications
// from opendeved.net/team/<person> (src/data/team-public.json holds the long text) and ekitabu.com/team, links from those
// pages, ORCID, GitHub and LinkedIn. Mock: nobody has agreed to be listed yet.
import PUBLIC from "./team-public.json";

// `logo` names each organisation's own mark as drawn for a dark panel (public/img/team/<logo>-light.avif): OpenDevEd's own
// light version, and eKitabu's with its black ink turned white. `art` is its picture (public/img/art-org-*) and `bg` that
// picture's flat colour.
export const ORGS = {
  ode: {
    name: "Open Development & Education", short: "OpenDevEd", url: "https://www.opendeved.net", host: "opendeved.net", logo: "org-ode", ratio: 720 / 169, art: "org-research", bg: "#011e5e", glow: "#8fb8ff",
    line: "A multinational and multicultural research team, working with an emphasis on equitable teams.",
    base: [["gb", "London"]],
    links: [["linkedin", "https://linkedin.com/company/opendeved"], ["x", "https://twitter.com/OpenDevEd"], ["github", "https://github.com/OpenDevEd"]],
  },
  ekitabu: {
    name: "eKitabu", short: "eKitabu", url: "https://www.ekitabu.com", host: "ekitabu.com", logo: "org-ekitabu", ratio: 720 / 140, art: "org-books", bg: "#450109", glow: "#ff9a8b",
    line: "Publishing stories of change, and building inclusive education across Africa, since 2012.",
    base: [["ke", "Nairobi"], ["rw", "Kigali"], ["mw", "Lilongwe"]],
    links: [["linkedin", "https://www.linkedin.com/company/ekitabu"], ["x", "https://x.com/eKitabu"], ["instagram", "https://www.instagram.com/eKitabu"], ["facebook", "https://www.facebook.com/eKitabu"]],
  },
};

// Each place in the order the globe visits it: Europe, down Africa, then across the Atlantic. A country's pin sits on its
// capital, except where a city is public (London, and Dar es Salaam and Johannesburg from public bios). `bg` is the flat
// colour of the place's picture (public/img/art-place-*), so a panel in that colour meets the picture without an edge.
// `side` is where the faces sit beside the pin on the globe, in pixels, so neighbours never cover each other.
export const PLACES = [
  { id: "london", name: "London", cc: "gb", lon: -0.13, lat: 51.51, tz: "Europe/London", bg: "#051535", glow: "#9cc8ff", side: [4, -46] },
  { id: "morocco", name: "Morocco", cc: "ma", lon: -6.84, lat: 34.02, tz: "Africa/Casablanca", bg: "#540218", glow: "#ff9a8b", side: [-58, -4] },
  { id: "nigeria", name: "Nigeria", cc: "ng", lon: 7.49, lat: 9.06, tz: "Africa/Lagos", bg: "#013627", glow: "#6ee7b7", side: [-44, 34] },
  { id: "kenya", name: "Kenya", cc: "ke", lon: 36.82, lat: -1.29, tz: "Africa/Nairobi", bg: "#3d0e00", glow: "#ffb347", side: [50, -30] },
  { id: "tanzania", name: "Tanzania", cc: "tz", lon: 39.21, lat: -6.79, tz: "Africa/Dar_es_Salaam", bg: "#013e5b", glow: "#5eead4", side: [58, 16] },
  { id: "south-africa", name: "South Africa", cc: "za", lon: 28.05, lat: -26.2, tz: "Africa/Johannesburg", bg: "#020917", glow: "#fbbf24", side: [10, 48] },
  { id: "united-states", name: "United States", cc: "us", lon: -77.04, lat: 38.91, tz: "America/New_York", bg: "#012676", glow: "#93c5fd", side: [-50, 26] },
  { id: "canada", name: "Canada", cc: "ca", lon: -75.7, lat: 45.42, tz: "America/Toronto", bg: "#013d3c", glow: "#67e8f9", side: [-30, -40] },
];
export const PLACE = Object.fromEntries(PLACES.map((p) => [p.id, p]));
// Links of light between the places, for the globe.
export const LINKS = [["london", "morocco"], ["london", "nigeria"], ["london", "kenya"], ["london", "canada"], ["london", "united-states"], ["morocco", "nigeria"], ["morocco", "united-states"], ["nigeria", "kenya"], ["nigeria", "south-africa"], ["kenya", "tanzania"], ["tanzania", "south-africa"], ["united-states", "canada"]];

const ek = (quote) => ({ quote, source: "https://www.ekitabu.com/team" });
const ode = (key) => PUBLIC[key];
export const TEAM = [
  { key: "bjorn", slug: "bjorn-hassler", name: "Björn Haßler", suffix: "PhD", role: "Director", org: "ode", place: "london", ...ode("bjorn"),
    links: [["linkedin", "https://www.linkedin.com/in/bjoernhassler/"], ["x", "https://twitter.com/bjoernhassler"], ["github", "https://github.com/bjohas"], ["orcid", "https://orcid.org/0000-0002-5277-9947"], ["instagram", "https://www.instagram.com/bjoernhassler/"], ["web", "http://www.bjohas.de/", "bjohas.de"]] },
  { key: "taskeen", slug: "taskeen-adam", name: "Taskeen Adam", suffix: "PhD", role: "Co-Director", org: "ode", place: "canada", ...ode("taskeen"),
    links: [["linkedin", "https://www.linkedin.com/in/taskeen-adam-2027a150/"], ["x", "https://twitter.com/Taskeeeners"], ["orcid", "https://orcid.org/0000-0003-2467-5726"], ["zotero", "https://www.zotero.org/taskeenadam"], ["web", "https://edtechhub.org/team/taskeen-adam", "EdTech Hub"]] },
  { key: "will", slug: "will-clurman", name: "Will Clurman", role: "Co-Founder & CEO", org: "ekitabu", place: "kenya", ...ek("Delivery motivates me and keeps me curious about how we, through our work, can include all children in quality education."),
    links: [["linkedin", "https://www.linkedin.com/in/willclurman/"]] },
  { key: "matt", slug: "matt-utterback", name: "Matt Utterback", role: "Co-Founder", org: "ekitabu", place: "united-states", ...ek("As a company leader, I hope to open the world of learning, leaving no one behind. I’m most proud of building and growing our talented team."),
    links: [["linkedin", "https://www.linkedin.com/in/matthewutterback/"]] },
  { key: "nafisa", slug: "nafisa-waziri", name: "Nafisa Waziri", suffix: "PhD", role: "Senior Portfolio Manager", org: "ode", place: "nigeria", ...ode("nafisa"),
    links: [["linkedin", "https://www.linkedin.com/in/nafisa-waziri-a1956349/"], ["orcid", "https://orcid.org/0000-0003-1698-8968"]] },
  { key: "hassan", slug: "hassan-mansour", name: "Hassan Mansour", role: "Technology & Innovation Manager", org: "ode", place: "morocco", ...ode("hassan"),
    links: [["linkedin", "https://www.linkedin.com/in/hassan-mansour-b176021a1/"], ["github", "https://github.com/suzuya1331"]] },
  { key: "mohammed", slug: "mohammed-charrad", name: "Mohammed Charrad", role: "Technology Analyst", org: "ode", place: "morocco", ...ode("mohammed"),
    links: [["github", "https://github.com/sickerine"]] },
  { key: "allan", slug: "allan-onyango", name: "Allan Onyango", role: "Senior Manager, Finance and Administration", org: "ekitabu", place: "kenya", ...ek("During my six year tenure at eKitabu, we have created a family of experts that strives for excellence in standards and quality service."),
    links: [] },
  { key: "gugulethu", slug: "gugulethu-dube", name: "Gugulethu Dube", role: "Analyst", org: "ode", place: "south-africa", ...ode("gugulethu"),
    links: [["linkedin", "https://www.linkedin.com/in/gugulethuvioletdube"], ["web", "https://www.mandelarhodes.org/scholarship/scholars/gugulethu-dube/", "Mandela Rhodes Foundation"]] },
  { key: "eunice", slug: "eunice-jengo", name: "Eunice Jengo", role: "PhD Student", org: "ode", place: "tanzania", ...ode("eunice"),
    links: [] },
];
// Every publication with a cover, once, newest first: the shelf on the About page. Each publication's link was checked on
// 13 Nov 2026: one whose DOI doesn't resolve is marked `unresolved`, links to its record in the Evidence Library instead,
// and is left off the shelf.
export const SHELF = [...new Map(TEAM.flatMap((m) => m.pubs ?? []).filter((b) => b.cover && !b.unresolved).map((b) => [b.id, b])).values()].sort((a, b) => b.year - a.year);
export const peopleIn = (place) => TEAM.filter((m) => m.place === place);
export const flag = (cc) => `/img/flags/${cc}.svg`;
export const LINK_NAMES = { linkedin: "LinkedIn", x: "X", github: "GitHub", orcid: "ORCID", instagram: "Instagram", zotero: "Zotero", facebook: "Facebook" };
// Fills every [data-tz] element with the time in its zone and whether it's day there. It runs as the page is read, before
// the first paint, so no time ever appears late, and again every 15 seconds.
export const CLOCK_JS = `(() => { const set = () => { for (const el of document.querySelectorAll("[data-tz]")) { const p = new Intl.DateTimeFormat("en-GB", { timeZone: el.dataset.tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()), h = p.find((x) => x.type === "hour").value, m = p.find((x) => x.type === "minute").value; el.querySelector("time").textContent = h + ":" + m; el.dataset.day = h >= 6 && h < 18 ? "1" : "0"; } }; set(); setInterval(set, 15000); })();`;
