// Marks of the services the publithon page names, drawn in one colour (currentColor) so they sit together on a dark panel.
// Semantic Scholar's is Simple Icons' (CC0). Crossref's is its own logo's five facets
// (assets.crossref.org), each at its own strength in place of its own colour. OpenAlex's is the app's mask
// (public/img/logo-openalex.png, from the app's public/openalex-tricon.png).
export const LOGOS = {
  semanticscholar: { name: "Semantic Scholar", box: "0 0 24 24", body: `<path d="M24 8.609c-.848.536-1.436.83-2.146 1.245-4.152 2.509-8.15 5.295-11.247 8.981l-1.488 1.817-4.568-7.268c1.021.814 3.564 3.098 4.603 3.599l3.356-2.526c2.336-1.644 8.946-5.226 11.49-5.848ZM8.046 15.201c.346.277.692.537.969.744.761-3.668.121-7.613-1.886-11.039 3.374-.052 6.731-.087 10.105-.139a14.794 14.794 0 0 1 1.298 5.295c.294-.156.588-.294.883-.433-.104-1.868-.641-3.91-1.662-6.263-4.602-.018-9.188-.018-13.79-.018 2.993 3.547 4.36 7.839 4.083 11.853Zm-.623-.484c.087.086.191.155.277.225-.138-3.409-1.419-6.887-3.824-9.881H1.73c3.098 2.855 4.984 6.299 5.693 9.656Zm-.744-.658c.104.087.208.173.329.277-.9-2.526-2.492-5.018-4.741-7.198H0c2.89 2.076 5.122 4.481 6.679 6.921Z" />` },
  crossref: { name: "Crossref", box: "0 0 46.6 67.9", body: `<polygon opacity=".8" points="0,67.9 0,47.4 16.8,41.9 46.6,52.1" /><polygon opacity=".55" points="29.8,26.1 0,36.4 16.8,41.9 46.6,31.7" /><polygon opacity=".35" points="16.8,41.9 46.6,31.7 46.6,52.1" /><polygon points="46.6,0.2 46.6,20.6 29.8,26.1 0,15.9" /><polygon opacity=".7" points="29.8,26.1 0,36.4 0,15.9" />` },
  openalex: { name: "OpenAlex", mask: "/img/logo-openalex.png", ratio: 520 / 488 },
};
