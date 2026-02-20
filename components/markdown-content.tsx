import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import type { Components } from "react-markdown";

const linkClassName = "text-primary underline-offset-4 hover:underline";

export const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="text-2xl sm:text-3xl font-semibold text-foreground mb-6">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-lg sm:text-xl font-semibold text-foreground mt-8 mb-4 pb-2 border-b border-border">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-base font-semibold text-foreground mt-6 mb-3">
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="text-muted-foreground leading-relaxed mb-4">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-6 my-4 space-y-1 text-muted-foreground">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-6 my-4 space-y-1 text-muted-foreground">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="my-1">{children}</li>,
  a: ({ href, children }) => {
    const url = href ?? "#";
    const isExternal = url.startsWith("http");
    return isExternal ? (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClassName}
      >
        {children}
      </a>
    ) : (
      <Link href={url} className={linkClassName}>
        {children}
      </Link>
    );
  },
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  hr: () => <hr className="my-8 border-border" />,
  table: ({ children }) => (
    <div className="my-6 overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="border-b border-border last:border-b-0">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-4 py-3 text-left font-medium text-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-4 py-3 text-muted-foreground">{children}</td>
  ),
};

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <article className={cn("text-sm sm:text-base", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </article>
  );
}
