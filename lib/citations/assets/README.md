# Citation assets

The citation formatter uses `citeproc-ts` and generated CSL assets from the
pinned `citeproc-plus` development dependency. It does not call a translation
service.

`csl.json` bundles five common CSL styles and nine locales with the lazy-loaded
formatter. BibTeX uses Citation.js. `catalog.json` lists another 2,851 styles and
loads only when the style picker opens. Selecting an additional style fetches
its compressed group from `public/citation-styles/`; content-addressed URLs and
an in-memory cache reuse downloads. Failed downloads can be retried.

The JSON provenance records the exact upstream commits. The styles and locales
are licensed CC BY-SA 3.0. The generated JSON drops each file's own attribution
and license block, so the credit they require is on the app's Credits page
(`content/credits/`), which links `public/citation-styles/credits.txt`. That file names
the authors of every bundled style and locale, and `npm run citations:generate`
rewrites it from the upstream repositories at the recorded commits. Upstream
sources:

- https://github.com/citation-style-language/styles
- https://github.com/citation-style-language/locales

Run `npm run citations:generate` with Node 22.18 or newer after deliberately
updating the pinned dependency. Commit the generated JSON and compressed assets,
and run the citation formatting and style-loading tests. The generator replaces
only `public/citation-styles/`, keeping 32 compressed groups out of the initial
JavaScript bundle.
