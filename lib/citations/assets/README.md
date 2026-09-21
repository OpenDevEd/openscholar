# Citation assets

These generated CSL styles and locales are bundled with the application. Citation
requests do not download styles or call a translation service.

The selected editions are listed in the adjacent citation format catalog. The
JSON provenance records the exact upstream commits; each CSL tree retains its
attribution and license information. Upstream sources:

- https://github.com/citation-style-language/styles
- https://github.com/citation-style-language/locales

Run `npm run citations:generate` with Node 22.18 or newer after deliberately
updating the pinned `citeproc-plus` development dependency. Commit the resulting
asset and run the citation formatting tests. The runtime uses `citeproc-ts`;
`citeproc-plus` is only the asset generation tool.
