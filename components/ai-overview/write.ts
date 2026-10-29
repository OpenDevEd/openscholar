// Mock (mock/ai-overview): what the Cheap model would write for a lens, put together from the
// search's real OpenAlex counts so every number on screen is true for the search. Charts take
// their numbers from the counts, never from the text, as the real feature's charts will.

import type { Group, OverviewData, TopPaper } from "@/app/actions/overview-mock";
import type { Angle } from "./lenses";

export type Part = string | { cite: TopPaper };
export type Block =
  | { kind: "text"; parts: Part[] }
  | { kind: "years"; groups: Group[] }
  | { kind: "change"; groups: Group[] }
  | { kind: "shares"; groups: Group[]; total: number }
  | { kind: "papers"; papers: TopPaper[] };

const n = (value: number) => value.toLocaleString("en");
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
const thisYear = new Date().getFullYear();

/** Full years only: the current one is still being published. */
const fullYears = (data: OverviewData) => data.years.filter((g) => Number(g.key) < thisYear);

function changes(years: Group[]) {
  return years.slice(1).map((g, i) => ({ key: g.key, name: g.name, count: years[i].count ? Math.round(((g.count - years[i].count) / years[i].count) * 100) : 0 }));
}

export function write(angle: Angle, data: OverviewData): Block[] {
  const { total, types, fields, countries, topCited, recent } = data;
  const years = fullYears(data);
  const peak = years.reduce<Group | undefined>((best, g) => (!best || g.count > best.count ? g : best), undefined);
  const last = years.at(-1);
  const partial = data.years.find((g) => Number(g.key) === thisYear);

  if (angle === "trend") {
    const window = years.slice(-11);
    const first = window[0];
    const delta = changes(window);
    const up = delta.reduce<Group | undefined>((best, g) => (!best || g.count > best.count ? g : best), undefined);
    const down = delta.reduce<Group | undefined>((best, g) => (!best || g.count < best.count ? g : best), undefined);
    const mean = delta.length ? delta.reduce((sum, g) => sum + g.count, 0) / delta.length : 0;
    const spread = delta.length ? Math.sqrt(delta.reduce((sum, g) => sum + (g.count - mean) ** 2, 0) / delta.length) : 0;
    if (!first || !last) return [{ kind: "text", parts: ["These results don't cover enough full years to compare them."] }];
    const ratio = first.count ? last.count / first.count : 0;
    return [
      { kind: "text", parts: [`Over the last ${window.length - 1} full years, output went from ${n(first.count)} papers in ${first.key} to ${n(last.count)} in ${last.key}, ${ratio >= 1 ? `${ratio.toFixed(1)} times as many` : `${Math.round((1 - ratio) * 100)}% fewer`}.`] },
      { kind: "years", groups: years.slice(-20) },
      { kind: "text", parts: [`Change from one year to the next averaged ${mean >= 0 ? "+" : ""}${Math.round(mean)}%, with a standard deviation of ${Math.round(spread)} points. ${up ? `${up.key} grew most, ${up.count >= 0 ? "up" : "down"} ${Math.abs(up.count)}% on the year before` : ""}${down && down.count < 0 ? `, and ${down.key} fell most, down ${Math.abs(down.count)}%.` : "."}`] },
      { kind: "change", groups: delta },
      ...(partial ? [{ kind: "text" as const, parts: [`${thisYear} isn't over: ${n(partial.count)} papers so far, so it's left out of the comparison.`] }] : []),
    ];
  }

  if (angle === "geography") {
    const top = countries.slice(0, 3);
    const visible = countries.filter((c) => pct(c.count, total) >= 1);
    if (!top.length) return [{ kind: "text", parts: ["OpenAlex doesn't record where the authors of these papers work."] }];
    return [
      { kind: "text", parts: [`Authors working in ${top[0].name} appear on ${pct(top[0].count, total)}% of these papers${top[1] ? `, followed by ${top[1].name} at ${pct(top[1].count, total)}%` : ""}${top[2] ? ` and ${top[2].name} at ${pct(top[2].count, total)}%` : ""}.`] },
      { kind: "shares", groups: countries.slice(0, 8), total },
      { kind: "text", parts: [`${visible.length} ${visible.length === 1 ? "country appears" : "countries appear"} on at least 1% of papers. A paper with authors in several countries counts for each of them.`] },
    ];
  }

  if (angle === "landmarks") {
    return [
      { kind: "text", parts: topCited.length ? ["The most cited paper here is ", { cite: topCited[0] }, `, with ${n(topCited[0].cited)} citations. These five are cited most:`] : ["None of these papers has been cited yet."] },
      { kind: "papers", papers: topCited },
      ...(recent.length ? [{ kind: "text" as const, parts: ["The newest are ", ...recent.slice(0, 3).flatMap((paper, i): Part[] => [...(i ? [i === 2 ? " and " : ", "] : []), { cite: paper }]), "."] }] : []),
    ];
  }

  return [
    {
      kind: "text",
      parts: [
        `${n(total)} papers match, and ${pct(data.openAccess, total)}% are free to read. ${types[0] ? `Most are ${types[0].name.toLowerCase()}s (${pct(types[0].count, total)}%)` : ""}${fields[0] ? `, mainly in ${fields[0].name}${fields[1] ? ` and ${fields[1].name}` : ""}` : ""}.`,
      ],
    },
    { kind: "years", groups: years.slice(-20) },
    { kind: "text", parts: [peak ? `Output peaked in ${peak.key} with ${n(peak.count)} papers${last && last.key !== peak.key ? `, and ${last.key} had ${n(last.count)}` : ""}. ` : "", ...(topCited.length >= 3 ? ["The most cited are ", { cite: topCited[0] }, ", ", { cite: topCited[1] }, " and ", { cite: topCited[2] }, "."] : [])] },
  ];
}

/** The overview as text to paste: its paragraphs, with each cited paper's title. */
export const plainText = (blocks: Block[]) =>
  blocks.flatMap((b) => (b.kind === "text" ? [b.parts.map((p) => (typeof p === "string" ? p : p.cite.title)).join("")] : [])).join("\n\n");
