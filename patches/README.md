# Export dependency fixes

The ExcelJS 4.4.0 patch encodes XML strings to UTF-8 before JSZip chunks them.
Its browser build already does this. The Node build otherwise splits a Unicode
surrogate pair at a 16,384-character boundary and writes replacement characters.
`tests/export-screening.test.ts` round-trips a long Unicode search snapshot
through the workbook bytes.

The BibTeX 0.9.0 patch keeps Unicode text, escapes TeX characters in literal
names, and includes abstracts, languages, keywords and translators through the
package's existing field converters. It matches the Evidence Library patch so
both apps produce reusable BibTeX. Both installed module builds are patched by
`npm ci` through the `patch-package` postinstall command.

`tests/citations.test.ts` checks exported Unicode names and special characters
by reimporting the generated BibTeX.
