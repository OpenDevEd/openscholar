import { Metadata } from "next";
import Link from "next/link";
import { readFileSync } from "fs";
import { join } from "path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PageWrapper } from "@/components/PageWrapper";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Privacy Policy | OpenScholar",
  description:
    "OpenScholar.ai customer privacy notice. Learn how Open Development & Education collects, uses, and protects your personal information.",
};

const markdownContent = readFileSync(
  join(process.cwd(), "content/privacy-policy.md"),
  "utf-8"
);

const markdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-2xl sm:text-3xl font-semibold text-foreground mb-6">
      {children}
    </h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-lg sm:text-xl font-semibold text-foreground mt-8 mb-4 pb-2 border-b border-border">
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-base font-semibold text-foreground mt-6 mb-3">
      {children}
    </h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-muted-foreground leading-relaxed mb-4">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc pl-6 my-4 space-y-1 text-muted-foreground">
      {children}
    </ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal pl-6 my-4 space-y-1 text-muted-foreground">
      {children}
    </ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="my-1">{children}</li>
  ),
  a: ({
    href,
    children,
  }: {
    href?: string;
    children?: React.ReactNode;
  }) => {
    const url = href ?? "#";
    const isExternal = url.startsWith("http");
    const className = "text-primary underline-offset-4 hover:underline";
    return isExternal ? (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {children}
      </a>
    ) : (
      <Link href={url} className={className}>
        {children}
      </Link>
    );
  },
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  hr: () => <hr className="my-8 border-border" />,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-6 overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-muted">{children}</thead>
  ),
  tbody: ({ children }: { children?: React.ReactNode }) => (
    <tbody>{children}</tbody>
  ),
  tr: ({ children }: { children?: React.ReactNode }) => (
    <tr className="border-b border-border last:border-b-0">{children}</tr>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="px-4 py-3 text-left font-medium text-foreground">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="px-4 py-3 text-muted-foreground">{children}</td>
  ),
};

export default function PrivacyPage() {
  return (
    <PageWrapper>
      <div className="container mx-auto px-4 sm:px-6 py-8 sm:py-12 max-w-3xl">
        <article className={cn("text-sm sm:text-base")}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {markdownContent}
          </ReactMarkdown>
        </article>

        <div className="mt-8 pt-6 border-t border-border">
          <Link
            href="/"
            className="text-sm font-medium text-primary hover:underline"
          >
            ← Back to OpenScholar
          </Link>
        </div>
      </div>
    </PageWrapper>
  );
}
