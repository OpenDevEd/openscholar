// APP_URL points a local copy of this site at a local copy of the app.
export const APP = process.env.APP_URL ?? "https://discover.openscholar.ai";
// Each row carries its own preview in the menu: a colour field and, where there is one, a real screen.
// Live Evidence Communities, shown in the home hero and the menu.
export const COMMUNITIES = [
  { key: "aied", name: "Artificial Intelligence in Education", url: "https://aied.openscholar.ai", host: "aied.openscholar.ai", color: "#fdba74", text: "Intelligent tutoring, learning analytics, automated feedback and assessment, AI literacy and generative AI in teaching" },
  { key: "wi", name: "Wealth Inequality and Social Mobility", url: "https://wealth-inequality.openscholar.ai", host: "wealth-inequality.openscholar.ai", color: "#34d399", text: "How wealth, assets and income are spread, how advantage passes between generations, and the policies that change them" },
  { key: "eccar", name: "Climate Change Adaptation and Resilience", url: "https://eccar.openscholar.ai", host: "eccar.openscholar.ai", color: "#a3e635", text: "How farms, cities, coasts, health systems and communities adapt to floods, drought, heat and other climate hazards" },
  { key: "tvet", name: "Technical and Vocational Education and Training", url: "https://tvet.openscholar.ai", host: "tvet.openscholar.ai", color: "#fb7185", text: "Vocational schools and colleges, apprenticeships and work-based learning, teachers, and skills for employment" },
  { key: "aimea", name: "Artificial Intelligence in Measurement and Education", url: "https://aievidencehub.org", host: "aievidencehub.org", color: "#fb923c", text: "Automated scoring, item generation, formative feedback, fairness and the evaluation of language models" },
  { key: "usaid", name: "USAID", url: "https://usaid.openscholar.ai", host: "usaid.openscholar.ai", color: "#fbbf24", text: "Research gathered in one place, to search, read and cite" },
];
export const NAV = [
  { id: "product", href: "/#product", label: "Product", rows: [
    { href: "/#product", title: "Find the literature", text: "Ask in plain language, keep control of the query", icon: "search", color: "#4fc3d9", field: "ocean", art: "sea", img: "search2-laptop-dark" },
    { href: "/#screening", title: "Screen against your criteria", text: "Decide once, apply it to every paper", icon: "sieve", color: "#34d399", field: "emerald", art: "sieve-front", img: "screen-laptop-dark" },
    { href: "/#extraction", title: "Extract and trace", text: "Answers you can sort, export and check", icon: "table", color: "#fde047", field: "night", art: "thread", img: "extract-laptop-dark" },
    { href: "/#assistant", title: "Delegate to the assistant", text: "Hand off the groundwork, keep the decisions", icon: "spark", color: "#7da7e6", field: "steel", art: "gate", img: "assistant-laptop-dark" },
  ] },
  { id: "communities", href: "/evidence-communities/", label: "Evidence Communities", rows: [
    { href: "/evidence-communities/#readers", title: "Search and read", text: "Everything your readers need to use the evidence", icon: "search", color: "#fb7185", field: "rose", art: "globe", img: "c-search-laptop-light" },
    { href: "/evidence-communities/#answers", title: "Answers readers can check", text: "Linked to the record and the page", icon: "thread", color: "#ff9d36", field: "night", art: "ask-lantern", img: "c-home2-laptop-dark" },
    { href: "/evidence-communities/#map", title: "Maps of your field", text: "Who's working on what, and where", icon: "globe", color: "#38bdf8", field: "night", art: "thread", img: "c-map-laptop-dark" },
    { href: "/evidence-communities/#steps", title: "From first draft to live", text: "Your name, your sources, your address", icon: "flag", color: "#fb7185", field: "rose", art: "globe", img: "c-home-laptop-light" },
  ], live: true },
  { id: "teams", href: "/teams/", label: "Teams", rows: [
    { href: "/teams/#shared", title: "One piece of shared work", text: "Six spreadsheets become one screening", icon: "merge", color: "#38bdf8", field: "ocean", art: "team-merge", img: "screen-laptop-light" },
    { href: "/teams/#activity", title: "See who did what", text: "A record of the changes, with a name beside each", icon: "list", color: "#34d399", field: "emerald", art: "team-merge", img: "extract-laptop-dark" },
    { href: "/teams/#publish", title: "Review before you publish", text: "Creators submit, editors decide", icon: "check", color: "#34d399", field: "emerald", art: "gates", img: "c-search-laptop-light" },
    { href: "/teams/#roles", title: "The right access for each person", text: "In your workspace and your community", icon: "key", color: "#7da7e6", field: "night", art: "team-merge" },
  ] },
  { id: "docs", href: "/docs/", label: "Docs" },
];
// Each page's sections, for the map of the page in the header once you scroll.
export const SECTIONS = {
  "/": [["tour", "Tour", "#ff9d36"], ["product", "Find", "#4fc3d9"], ["screening", "Screen", "#34d399"], ["extraction", "Extract", "#fde047"], ["assistant", "Assistant", "#7da7e6"], ["community", "Communities", "#fb7185"]],
  "/evidence-communities/": [["readers", "Readers", "#4fc3d9"], ["answers", "Answers", "#ff9d36"], ["map", "Map", "#38bdf8"], ["review", "Review", "#34d399"], ["steps", "Go live", "#fb7185"]],
  "/teams/": [["activity", "Activity", "#34d399"], ["shared", "Shared work", "#38bdf8"], ["roles", "Access", "#7da7e6"], ["publish", "Review", "#34d399"]],
};
export const ICONS = {
  search: "M9 16a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm5-2 5 5",
  sieve: "M3 4h14l-5 7v6l-4-2v-4L3 4Z",
  table: "M3 4h14v12H3V4Zm0 4h14M3 12h14M9 4v12",
  spark: "M10 2v5m0 6v5M2 10h5m6 0h5M5 5l2 2m6 6 2 2m0-10-2 2m-6 6-2 2",
  thread: "M2 10h16M6 5v10M10 5v10M14 5v10",
  globe: "M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM2 10h16M10 2c-3 3-3 13 0 16 3-3 3-13 0-16",
  flag: "M5 18V3m0 1h10l-2 3.500 2 3.500H5",
  merge: "M3 4c6 0 4 6 10 6M3 16c6 0 4-6 10-6h4m-3-3 3 3-3 3",
  list: "M7 5h10M7 10h10M7 15h10M3 5h.01M3 10h.01M3 15h.01",
  key: "M13 11a4 4 0 1 0-3.500-2L3 15.500V18h3v-2h2v-2h2l1-1",
  cross: "M6 6l8 8M14 6l-8 8",
  check: "m4 10.500 4 4 8-9",
  flagq: "M10 4v8m0 4v.01",
  pen: "M4 16l1-4L14 3l3 3-9 9-4 1ZM12 5l3 3",
  mail: "M3 5h14v10H3V5Zm0 1 7 5 7-5",
  cite: "M4 4h9l3 3v9H4V4Zm3 5h6M7 12h6",
  lock: "M5 9h10v8H5V9Zm2 0V6.500a3 3 0 0 1 6 0V9",
  sun: "M10 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM10 2v1.500M10 16.500V18M2 10h1.500M16.500 10H18M4.300 4.300l1.100 1.100M14.600 14.600l1.100 1.100M4.300 15.700l1.100-1.100M14.600 5.400l1.100-1.100",
  moon: "M17 11.500A7.500 7.500 0 0 1 8.500 3a7.500 7.500 0 1 0 8.500 8.500Z",
};
