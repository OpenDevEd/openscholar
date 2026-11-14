// APP_URL points a local copy of this site at a local copy of the app.
export const APP = process.env.APP_URL ?? "https://discover.openscholar.ai";
// The Turnstile widget the contact form proves a visitor is a person with: production's, whose secret the app checks it with.
// A local copy pointed at another app sets the key that app checks.
export const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY ?? "0x4AAAAAAF1cTpm8gRNzExmz";
// Analytics, the same PostHog project and Google property as the app. A local copy sends nothing (lib/posthog-options.ts).
export const POSTHOG_KEY = process.env.POSTHOG_KEY ?? "phc_9MBX1GmcLFij9i2EOaZkrlcMU92ZaHpNqF5bGQf05Xj";
export const GA_ID = process.env.GA_ID ?? "G-KL62MG5H1G";
// Asks for the planet's four maps as a page arrives, not once its script has run, unless the planet will be the still: data
// saver, a 2G connection, or a level this visit already settled on (the key is src/planet/earth.js's MEMORY). The home hero
// and the About page's globe both run it.
export const EARTH_PRELOAD_JS = '(() => { const c = navigator.connection; let l = -1; try { l = Number(sessionStorage.getItem("openscholar.planet-level") ?? -1); } catch {} if (l === 0 || (c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || "")))) return; for (const n of ["day-2048", "night", "clouds", "water"]) { const k = document.createElement("link"); k.rel = "preload"; k.as = "image"; k.fetchPriority = "high"; k.href = "/img/earth-" + n + ".avif"; document.head.append(k); } })();';
// Each row carries its own preview in the menu: a colour field and, where there is one, a real screen.
// Live Evidence Communities, shown in the home hero and the menu.
export const COMMUNITIES = [
  { key: "aied", name: "Artificial Intelligence in Education", url: "https://aied.openscholar.ai", host: "aied.openscholar.ai", color: "#fdba74", text: "Intelligent tutoring, learning analytics, automated feedback and assessment, AI literacy and generative AI in teaching" },
  { key: "wi", name: "Wealth Inequality and Social Mobility", url: "https://wealth-inequality.openscholar.ai", host: "wealth-inequality.openscholar.ai", color: "#34d399", text: "How wealth, assets and income are spread, how advantage passes between generations, and the policies that change them" },
  { key: "eccar", name: "Climate Change Adaptation and Resilience", url: "https://eccar.openscholar.ai", host: "eccar.openscholar.ai", color: "#a3e635", text: "How farms, cities, coasts, health systems and communities adapt to floods, drought, heat and other climate hazards" },
  { key: "tvet", name: "Technical and Vocational Education and Training", url: "https://tvet.openscholar.ai", host: "tvet.openscholar.ai", color: "#fb7185", text: "Vocational schools and colleges, apprenticeships and work-based learning, teachers, and skills for employment" },
  { key: "usaid", name: "USAID", url: "https://usaid.openscholar.ai", host: "usaid.openscholar.ai", color: "#fbbf24", text: "Research gathered in one place, to search, read and cite" },
];
export const NAV = [
  { id: "product", href: "/#product", label: "Product", rows: [
    { href: "/ai-literature-review/", title: "Find the literature", text: "Ask in plain language, keep control of the query", icon: "search", color: "#4fc3d9", field: "ocean", art: "sea", img: "search2-laptop-dark" },
    { href: "/systematic-review-screening/", title: "Screen against your criteria", text: "Decide once, apply it to every paper", icon: "sieve", color: "#34d399", field: "emerald", art: "sieve-front", img: "screen-laptop-dark" },
    { href: "/data-extraction/", title: "Extract and trace", text: "Answers you can sort, export and check", icon: "table", color: "#fde047", field: "night", art: "thread", img: "extract-laptop-dark" },
    { href: "/research-assistant/", title: "Delegate to the assistant", text: "Hand off the groundwork, keep the decisions", icon: "spark", color: "#7da7e6", field: "steel", art: "gate", img: "assistant-laptop-dark" },
  ] },
  { id: "communities", href: "/evidence-communities/", label: "Evidence Communities", rows: [
    { href: "/evidence-communities/#readers", title: "Search and read", text: "Everything your readers need to use the evidence", icon: "search", color: "#fb7185", field: "rose", art: "globe", img: "c-search-laptop-light" },
    { href: "/evidence-communities/#answers", title: "Answers readers can check", text: "Linked to the record and the page", icon: "thread", color: "#ff9d36", field: "night", art: "ask-lantern", img: "c-home2-laptop-dark" },
    { href: "/evidence-communities/#map", title: "Maps of your field", text: "Who's working on what, and where", icon: "globe", color: "#38bdf8", field: "night", art: "thread", img: "c-map-laptop-dark" },
    { href: "/evidence-communities/#steps", title: "From first draft to live", text: "Your name, your sources, your address", icon: "flag", color: "#fb7185", field: "rose", art: "globe", img: "c-home-laptop-light" },
  ], live: true },
  { id: "publish", href: "/publithon/", label: "Publish", rows: [
    { href: "/publithon/#publish", title: "From PDF to DOI", text: "Sign, upload, check, and your report is live", icon: "pen", color: "#fbbf24", field: "night", art: "pub-rise" },
    { href: "/publithon/#doi", title: "What a DOI gives your work", text: "A permanent link, cited in one paste", icon: "thread", color: "#38bdf8", field: "night", art: "pub-rise", img: "r-page-laptop-light" },
    { href: "/publithon/#done", title: "The paperwork, done for you", text: "Details read from your PDF, the DOI registered", icon: "check", color: "#7da7e6", field: "steel", art: "pub-paperwork-wide" },
    { href: "/publithon/#sponsor", title: "Sponsor a publithon", text: "Back research on a topic or a region", icon: "globe", color: "#ff9d36", field: "night", art: "pub-world" },
  ] },
  { id: "docs", href: "/docs/", label: "Docs" },
];
// Each page's sections, for the map of the page in the header once you scroll.
export const SECTIONS = {
  "/": [["tour", "Tour", "#ff9d36"], ["product", "Find", "#4fc3d9"], ["screening", "Screen", "#34d399"], ["extraction", "Extract", "#fde047"], ["assistant", "Assistant", "#7da7e6"], ["community", "Communities", "#fb7185"]],
  "/evidence-communities/": [["readers", "Readers", "#4fc3d9"], ["answers", "Answers", "#ff9d36"], ["map", "Map", "#38bdf8"], ["review", "Review", "#34d399"], ["steps", "Go live", "#fb7185"]],
  "/teams/": [["activity", "Activity", "#34d399"], ["shared", "Shared work", "#38bdf8"], ["roles", "Access", "#7da7e6"], ["publish", "Review", "#34d399"]],
  "/about/": [["places", "Places", "#ff9d36"], ["team", "Team", "#38bdf8"], ["research", "Research", "#fbbf24"], ["makers", "Organisations", "#34d399"]],
  "/publithon/": [["publish", "Steps", "#fbbf24"], ["doi", "DOI", "#38bdf8"], ["done", "Done for you", "#7da7e6"], ["ways", "Take part", "#34d399"], ["sponsor", "Sponsor", "#ff9d36"]],
};
// Pages written for what people search when they need the product. Each links to the others, and the menu and footer link to them.
export const INTENTS = [
  { href: "/ai-literature-review/", title: "AI literature reviews", text: "From your question to a table of findings", color: "#4fc3d9", img: "search-laptop-dark-1000" },
  { href: "/systematic-review-screening/", title: "Screening for systematic reviews", text: "Your criteria, applied to every abstract", color: "#34d399", img: "screen-laptop-dark-1000" },
  { href: "/data-extraction/", title: "Data extraction", text: "A table of answers, each with its evidence", color: "#fde047", img: "extract-detail-laptop-dark-1000" },
  { href: "/research-assistant/", title: "AI research assistant", text: "Hand off the groundwork, keep the decisions", color: "#7da7e6", img: "assistant-laptop-dark-1000" },
  { href: "/rapid-evidence-review/", title: "Rapid evidence reviews", text: "A defensible answer, with its sources attached", color: "#ff9d36", img: "search-laptop-light-1000" },
  { href: "/zotero/", title: "Publish a Zotero library", text: "A public, searchable site from a Zotero group", color: "#fb7185", img: "c-home-laptop-light-1000" },
];

// Pages for people choosing between tools. What each one says about another product comes from that product's own site, checked on the date given, and claims nothing it doesn't say.
export const COMPARISONS = [
  { href: "/covidence-alternative/", name: "Covidence", checked: "9 November 2026",
    they: "Covidence manages a review through its stages: you import references from your databases or reference manager, screen titles and abstracts with two reviewers, review full texts, extract data and assess risk of bias. It can sort records by relevance as you screen, and suggests extracted data from the PDFs you upload.",
    rows: [["Finding papers", "Import references from your databases or reference manager", "Search a catalogue of scholarly work across every field from a plain-language question, or bring your own collections and Zotero items"], ["Screening", "Two reviewers decide each record; machine learning can sort records by relevance", "AI answers your criteria questions for every paper, your points and pass mark decide, and you overrule any answer"], ["Data extraction", "Suggestions from uploaded PDFs, checked by reviewers", "A table of answers from titles and abstracts, each with its confidence and the passage it came from"], ["After the review", "Export your data", "Export as CSV, JSON or Excel, or publish the evidence as a public, searchable site for your field"]] },
  { href: "/rayyan-alternative/", name: "Rayyan", checked: "9 November 2026",
    they: "Rayyan is a review platform: you import and deduplicate references, then screen titles, abstracts and full texts with your team, with blinding, AI that prioritises records and recommends decisions, and AI extraction from full texts.",
    rows: [["Finding papers", "Import references and remove duplicates", "Search a catalogue of scholarly work across every field from a plain-language question, or bring your own collections and Zotero items"], ["Screening", "Reviewers decide each record, with AI prioritising records and recommending decisions", "AI answers your criteria questions for every paper, your points and pass mark decide, and you overrule any answer"], ["Working as a team", "Screen together, with blinding so reviewers don't see each other's decisions", "An organization where every search, screening and extraction is shared, with who did what beside each change"], ["After the review", "Export your decisions", "Export as CSV, JSON or Excel, or publish the evidence as a public, searchable site for your field"]] },
  { href: "/elicit-alternative/", name: "Elicit", checked: "9 November 2026",
    they: "Elicit is an AI research assistant: it searches its own database of papers and sources such as PubMed, screens papers against criteria it suggests, extracts data into tables and writes reports from what it found.",
    rows: [["Finding papers", "Search its database of papers, PubMed and ClinicalTrials.gov, or import from other databases", "Search a catalogue of scholarly work across every field, with a query you can read and change, and filters for years, places and study designs"], ["Screening", "Screen against criteria", "Questions worth the points you set, a pass mark you can move, and every answer open to overrule"], ["Data extraction", "Extract data into tables", "A table of answers from titles and abstracts, each with its confidence and the passage it came from, open beside the table"], ["After the review", "Reports and exports", "Exports as CSV, JSON or Excel, and a public, searchable site for your field's evidence under your own name"]] },
];
