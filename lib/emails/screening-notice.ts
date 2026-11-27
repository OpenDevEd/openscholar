import { escapeHtml } from "../escape-html";
import { emailButton, emailStyles, renderLibraryEmail } from "./library-template";

/** What a screening tells one of its people by email: new papers wait for their vote, conflicts wait for them to settle, someone reminds them of the papers that wait, or someone put them on it. */
export type NoticeAbout = "papers" | "conflicts" | "reminder" | "joined";

const num = (n: number) => n.toLocaleString("en-GB");
const papers = (n: number, more = false) => `${num(n)} ${more ? "or more papers" : n === 1 ? "paper" : "papers"}`;

/**
 * The email a screening sends one person (convex/screening/noticeMail.ts): what waits for them, a link to it, and
 * the link that turns this screening's emails off for them alone.
 */
export function screeningNoticeMessage({ origin, path, name, about, count, more = false, by }: {
  origin: string;
  /** The screening's own page, with its workspace's prefix where it has one. */
  path: string;
  name: string;
  about: NoticeAbout;
  /** How many papers wait for them: to vote on, or to settle. */
  count: number;
  /** The count is where counting stopped: there are at least that many. */
  more?: boolean;
  /** Who sent a reminder, or put them on the screening. */
  by?: string;
}) {
  const identity = { name: "Openscholar", baseUrl: origin, logoUrl: new URL("/web-app-manifest-192x192.png", origin).href, accent: "#ed7b15" };
  // Someone put on a screening with nothing to vote on yet opens its Overview: their To do would be empty.
  const open = new URL(about === "conflicts" ? `${path}/screen?queue=conflicts` : about === "joined" && !count ? path : `${path}/screen`, origin).href;
  const off = new URL(`${path}?emails=off`, origin).href;
  const [subject, line, button] =
    about === "conflicts"
      ? [`${papers(count)} in conflict in "${name}"`, `The reviewers of "${name}" split on ${count === 1 ? "a paper" : `${papers(count)}`}, and you settle conflicts on it.`, count === 1 ? "Settle it" : "Settle them"]
      : about === "joined"
        ? [`You review "${name}"`, `${by ?? "A colleague"} added you as a reviewer of "${name}". ${count ? `${papers(count)} ${count === 1 ? "waits" : "wait"} for your vote.` : "No paper waits for your vote yet: new ones come to you as they arrive."}`, count === 1 ? "Screen it" : count ? "Screen them" : "Open it"]
      : about === "reminder"
        ? [`${papers(count)} ${count === 1 ? "waits" : "wait"} for your vote in "${name}"`, `${by ?? "A colleague"} reminds you that ${papers(count)} of "${name}" ${count === 1 ? "waits" : "wait"} for your vote.`, count === 1 ? "Screen it" : "Screen them"]
        : [`${papers(count, more)} to screen in "${name}"`, `${count === 1 ? "A new paper" : `${papers(count, more)} new`} arrived in "${name}" and ${count === 1 ? "waits" : "wait"} for your vote.`, count === 1 ? "Screen it" : "Screen them"];
  return {
    subject,
    text: `${line}\n\n${open}\n\nStop receiving emails from this screening\n${off}`,
    html: renderLibraryEmail({
      identity,
      title: subject,
      content: `<p style="${emailStyles.paragraph}">${escapeHtml(line)}</p>${emailButton(button, open, identity.accent)}`,
      footerHtml: `You received this email because you are on the screening ${escapeHtml(name)} on Openscholar. <a href="${escapeHtml(off)}" style="${emailStyles.link}">Stop receiving emails from this screening</a>.`,
    }),
  };
}
