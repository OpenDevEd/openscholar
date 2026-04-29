// Curated short list of high-signal scholarly hosts. Per Tavily best practices
// (docs.tavily.com/documentation/best-practices/best-practices-search) keep
// include-domain lists short — long lists hurt recall. The "*.host" prefix is
// the Tavily-documented form for matching subdomains; bare entries match the
// apex only.
export const INCLUDE_DOMAINS_ACADEMIC = [
  "arxiv.org",
  "*.arxiv.org",
  "ncbi.nlm.nih.gov",
  "pubmed.ncbi.nlm.nih.gov",
  "semanticscholar.org",
  "openalex.org",
  "scholar.google.com",
  "nature.com",
  "science.org",
  "biorxiv.org",
  "medrxiv.org",
  "doaj.org",
] as const;
