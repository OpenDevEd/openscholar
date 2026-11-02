export const APP = "https://dev.openscholar.ai";
// Each row carries its own preview in the menu: a colour field and, where there is one, a real screen.
export const NAV = [
  { id: "product", href: "/#product", label: "Product", rows: [
    { href: "/#product", title: "Find the literature", text: "Ask in plain language, keep control of the query", icon: "search", field: "ocean", art: "sea", img: "shot-search2" },
    { href: "/#screening", title: "Screen against your criteria", text: "Decide once, apply it to every paper", icon: "sieve", field: "emerald", art: "sieve", img: "shot-screen" },
    { href: "/#extraction", title: "Extract the data", text: "From papers to a table you can check", icon: "table", field: "amber", art: "grid", img: "shot-extract" },
    { href: "/#assistant", title: "Delegate to the assistant", text: "It does the groundwork and asks before it acts", icon: "spark", field: "cobalt", art: "gate", img: "shot-assistant" },
    { href: "/#trust", title: "Trace answers back", text: "From a cited answer to its sentence and paper", icon: "thread", field: "night", art: "thread" },
  ] },
  { id: "communities", href: "/evidence-communities/", label: "Evidence Communities", rows: [
    { href: "/evidence-communities/#readers", title: "Search and read", text: "Everything your readers need to use the evidence", icon: "search", field: "rose", art: "globe", img: "community-search" },
    { href: "/evidence-communities/#answers", title: "Answers readers can check", text: "Linked to the record and the page", icon: "thread", field: "amber", art: "grid", img: "community-plate" },
    { href: "/evidence-communities/#map", title: "Maps of your field", text: "Who's working on what, and where", icon: "globe", field: "night", art: "thread", img: "community-evidence" },
    { href: "/evidence-communities/#steps", title: "From first draft to live", text: "Your name, your sources, your address", icon: "flag", field: "rose", art: "globe", img: "community-home" },
  ], live: [["Wealth Inequality and Social Mobility", "https://wealth-inequality.openscholar.ai"], ["Artificial Intelligence in Education", "https://aied.openscholar.ai"]] },
  { id: "teams", href: "/teams/", label: "Teams", rows: [
    { href: "/teams/#shared", title: "One piece of shared work", text: "Six spreadsheets become one screening", icon: "merge", field: "ocean", art: "converge", img: "shot-screen" },
    { href: "/teams/", title: "See who did what", text: "A record of every change, with a name beside it", icon: "list", field: "emerald", art: "sieve", img: "shot-extract" },
    { href: "/teams/#roles", title: "The right access for each person", text: "Admins, members and guests", icon: "key", field: "night", art: "converge" },
  ] },
  { id: "docs", href: "/docs/", label: "Docs" },
];
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
};
