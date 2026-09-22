import { createElement, type CSSProperties } from "react";
import parse, { domToReact, Element, type DOMNode, type HTMLReactParserOptions } from "html-react-parser";
import type { FormattedCitation } from "@/lib/citations/formats";

const tags = new Set(["div", "span", "i", "em", "b", "strong", "sup", "sub"]);
const classes = new Set(["csl-entry", "csl-block", "csl-left-margin", "csl-right-inline", "csl-indent"]);
const typography: Record<string, CSSProperties> = {
  "font-style:normal": { fontStyle: "normal" },
  "font-variant:small-caps": { fontVariant: "small-caps" },
  "font-variant:normal": { fontVariant: "normal" },
  "font-weight:normal": { fontWeight: "normal" },
  "text-decoration:underline": { textDecoration: "underline" },
  "text-decoration:none": { textDecoration: "none" },
};

function citationHref(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}

// Parse CSL markup into React elements. Never forward arbitrary HTML attributes,
// styles, or elements from bibliographic metadata into the page.
const options: HTMLReactParserOptions = {
  replace(node) {
    if (!(node instanceof Element)) return;
    if (!tags.has(node.name) && node.name !== "a") return <></>;
    const children = domToReact(node.children as DOMNode[], options);
    if (node.name === "a") {
      const href = citationHref(node.attribs.href);
      return href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <>{children}</>;
    }
    const style = Object.assign({}, ...((node.attribs.style ?? "").split(";").map(rule => typography[rule.replace(/\s/g, "")])));
    return createElement(node.name, {
      className: classes.has(node.attribs.class) ? node.attribs.class : undefined,
      style,
    }, children);
  },
};

export function CitationText({ citation }: { citation: FormattedCitation }) {
  return citation.html === null ? (
    <pre className="whitespace-pre-wrap break-words font-mono text-xs">{citation.text}</pre>
  ) : (
    <div className="leading-relaxed [overflow-wrap:anywhere] [&_a]:text-primary [&_a:hover]:underline [&_a:focus-visible]:underline [&_.csl-left-margin]:float-left [&_.csl-left-margin]:mr-2 [&_.csl-right-inline]:overflow-hidden [&_.csl-indent]:ml-4 [&_.csl-entry]:flow-root">
      {parse(citation.html, options)}
    </div>
  );
}
