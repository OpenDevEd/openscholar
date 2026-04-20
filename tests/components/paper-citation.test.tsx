/**
 * @vitest-environment jsdom
 *
 * Behavioral tests for <PaperCitation> — the inline chat citation chip.
 *
 * Contracts we care about (all surfaced via accessible DOM and
 * `data-citation-state`, never CSS classes — see CLAUDE.md testing
 * philosophy):
 *  - tri-state: included / excluded / unresolved surfaces via
 *    `data-citation-state`
 *  - resolved citations render as a real <a href=…> link (incl. excluded
 *    pills — citations are never dead)
 *  - the pill always points at OpenAlex when an openalexId is present
 *    (the guaranteed baseline destination); DOI and PDF are additive
 *    buttons inside the hover card
 *  - opens in a new tab with rel="noreferrer"
 *  - hover card exposes up to three link buttons plus a Re-include
 *    action when the state is `excluded`
 *  - unresolved citations render as non-interactive `[N?]` text with
 *    data-citation-state="unresolved" + data-paper-resolved="false"
 *  - re-include clicks call toggleChatPaper with the correct args
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaperCitation } from "@/components/extraction/chat/paper-citation";
import { PapersContext } from "@/components/extraction/chat/papers-context";
import type { ResolvablePaper } from "@/lib/chat/resolve-paper";
import type { Id } from "@/convex/_generated/dataModel";
import { fakePapersContext } from "@/tests/helpers/papers-context-fixture";

function renderCitation({
  index,
  paper,
  jobId,
}: {
  index: number;
  paper: ResolvablePaper | null;
  jobId: Id<"extractionJobs">;
}) {
  const papersByPosition = new Map<number, ResolvablePaper>();
  if (paper) papersByPosition.set(index, paper);
  return render(
    <PapersContext.Provider
      value={fakePapersContext({ jobId, papersByPosition })}
    >
      <PaperCitation index={index} />
    </PapersContext.Provider>,
  );
}

const toggleSpy = vi.fn(async () => undefined);

vi.mock("convex/react", () => ({
  useMutation: () => {
    const fn = toggleSpy;
    Object.assign(fn, { withOptimisticUpdate: () => fn });
    return fn;
  },
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    chat: {
      chatPapers: {
        toggleChatPaper: "stub:toggleChatPaper",
        listChatSourcesWithInclusion: "stub:listChatSourcesWithInclusion",
      },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: Object.assign(() => {}, { error: vi.fn() }),
}));

// Radix HoverCard uses pointer-capture APIs that JSDOM doesn't ship.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
});

beforeEach(() => {
  toggleSpy.mockClear();
});

async function openHoverCard(labelMatch: RegExp = /chatCitationOpen/) {
  const user = userEvent.setup();
  const pill = screen.getByRole("link", { name: labelMatch });
  await user.hover(pill);
  await waitFor(() => {
    const anyBtn =
      document.querySelector("a[data-paper-card-link]") ??
      document.querySelector("[data-reinclude-action]");
    expect(anyBtn).not.toBeNull();
  });
}

vi.mock("next-intl", () => ({
  useTranslations: () =>
    (key: string, params?: Record<string, string | number>) => {
      if (params?.title) return `${key}:${params.title}`;
      if (params?.index != null) return `${key}:${params.index}`;
      return key;
    },
}));

const JOB_ID = "job_test" as Id<"extractionJobs">;

const mkPaper = (over: Partial<ResolvablePaper> = {}): ResolvablePaper => ({
  sourceId: "src_1" as Id<"extractionJobSources">,
  chatPaperId: "cp_1" as Id<"chatPapers">,
  position: 3,
  title: "A study of citation behavior",
  authors: ["Doe, J.", "Smith, A."],
  year: 2024,
  abstract: null,
  openalexId: "W1234567890",
  doi: null,
  pdfUrl: null,
  included: true,
  ...over,
});

function getPill(labelMatch: RegExp = /chatCitationOpen/): HTMLAnchorElement {
  return screen.getByRole("link", { name: labelMatch }) as HTMLAnchorElement;
}

describe("<PaperCitation>", () => {
  it("renders a resolved citation as an <a> link", () => {
    renderCitation({ index: 3, paper: mkPaper(), jobId: JOB_ID });
    const pill = getPill();
    expect(pill.tagName).toBe("A");
    expect(pill).toHaveTextContent("3");
  });

  it("pill always points at OpenAlex when openalexId is present", () => {
    renderCitation({
      index: 2,
      paper: mkPaper({ doi: "10.1234/abc.2024" }),
      jobId: JOB_ID,
    });
    expect(getPill().getAttribute("href")).toBe(
      "https://openalex.org/W1234567890",
    );
  });

  it("falls back to DOI on the pill when no openalexId is present", () => {
    renderCitation({
      index: 1,
      paper: mkPaper({ openalexId: null, doi: "10.1234/abc.2024" }),
      jobId: JOB_ID,
    });
    expect(getPill().getAttribute("href")).toBe(
      "https://doi.org/10.1234/abc.2024",
    );
  });

  it("opens the pill in a new tab with rel=noreferrer", () => {
    renderCitation({ index: 1, paper: mkPaper(), jobId: JOB_ID });
    const pill = getPill();
    expect(pill.getAttribute("target")).toBe("_blank");
    expect(pill.getAttribute("rel") ?? "").toMatch(/noreferrer/);
  });

  it("exposes an aria-label describing the destination paper on the pill", () => {
    renderCitation({
      index: 1,
      paper: mkPaper({ title: "My Paper" }),
      jobId: JOB_ID,
    });
    expect(getPill().getAttribute("aria-label")).toContain("My Paper");
  });

  it("marks the pill with data attributes for downstream tooling", () => {
    renderCitation({
      index: 5,
      paper: mkPaper({ sourceId: "s_abc" as Id<"extractionJobSources"> }),
      jobId: JOB_ID,
    });
    const pill = getPill();
    expect(pill.getAttribute("data-paper-resolved")).toBe("true");
    expect(pill.getAttribute("data-paper-index")).toBe("5");
    expect(pill.getAttribute("data-paper-id")).toBe("s_abc");
  });

  it("renders an OpenAlex action button in the hover card when openalexId is present", async () => {
    renderCitation({ index: 1, paper: mkPaper(), jobId: JOB_ID });
    await openHoverCard();
    const openalexBtn = document.querySelector(
      'a[data-paper-card-link="openalex"]',
    ) as HTMLAnchorElement | null;
    expect(openalexBtn).not.toBeNull();
    expect(openalexBtn!.getAttribute("href")).toBe(
      "https://openalex.org/W1234567890",
    );
  });

  it("renders a DOI action button in the hover card when doi is present", async () => {
    renderCitation({
      index: 1,
      paper: mkPaper({ doi: "10.1234/abc.2024" }),
      jobId: JOB_ID,
    });
    await openHoverCard();
    const doiBtn = document.querySelector(
      'a[data-paper-card-link="doi"]',
    ) as HTMLAnchorElement | null;
    expect(doiBtn).not.toBeNull();
    expect(doiBtn!.getAttribute("href")).toBe(
      "https://doi.org/10.1234/abc.2024",
    );
    expect(doiBtn!).toHaveTextContent("10.1234/abc.2024");
  });

  it("renders a PDF action button in the hover card when pdfUrl is present", async () => {
    renderCitation({
      index: 1,
      paper: mkPaper({ pdfUrl: "https://example.com/paper.pdf" }),
      jobId: JOB_ID,
    });
    await openHoverCard();
    const pdfBtn = document.querySelector(
      'a[data-paper-card-link="pdf"]',
    ) as HTMLAnchorElement | null;
    expect(pdfBtn).not.toBeNull();
    expect(pdfBtn!.getAttribute("href")).toBe("https://example.com/paper.pdf");
  });

  it("hides action buttons for missing identifiers", async () => {
    renderCitation({
      index: 1,
      paper: mkPaper({ openalexId: "W1", doi: null, pdfUrl: null }),
      jobId: JOB_ID,
    });
    await openHoverCard();
    expect(
      document.querySelector('a[data-paper-card-link="openalex"]'),
    ).not.toBeNull();
    expect(document.querySelector('a[data-paper-card-link="doi"]')).toBeNull();
    expect(document.querySelector('a[data-paper-card-link="pdf"]')).toBeNull();
  });

  it("normalises a DOI that is already a full URL", async () => {
    renderCitation({
      index: 1,
      paper: mkPaper({ doi: "https://doi.org/10.9/XYZ" }),
      jobId: JOB_ID,
    });
    await openHoverCard();
    const doiBtn = document.querySelector(
      'a[data-paper-card-link="doi"]',
    ) as HTMLAnchorElement | null;
    expect(doiBtn!.getAttribute("href")).toBe("https://doi.org/10.9/XYZ");
    expect(doiBtn!).toHaveTextContent("10.9/XYZ");
  });

  it("renders unresolved (paper=null) as non-link muted text", () => {
    renderCitation({ index: 99, paper: null, jobId: JOB_ID });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("99?")).toBeInTheDocument();
    const el = screen.getByText("99?");
    expect(el.getAttribute("data-paper-resolved")).toBe("false");
    expect(el.getAttribute("data-citation-state")).toBe("unresolved");
  });

  it("renders non-link pill when paper has no identifier at all", () => {
    renderCitation({
      index: 7,
      paper: mkPaper({
        openalexId: null,
        doi: null,
        pdfUrl: null,
      }),
      jobId: JOB_ID,
    });
    expect(screen.queryByRole("link")).toBeNull();
    const pill = screen.getByRole("button", { name: /chatCitationPreview/ });
    expect(pill).toHaveTextContent("7");
  });

  describe("tri-state", () => {
    it("marks an included pill with data-citation-state='included'", () => {
      renderCitation({
        index: 3,
        paper: mkPaper({ included: true }),
        jobId: JOB_ID,
      });
      expect(getPill().getAttribute("data-citation-state")).toBe("included");
    });

    it("marks an excluded pill with data-citation-state='excluded'", () => {
      renderCitation({
        index: 3,
        paper: mkPaper({ included: false }),
        jobId: JOB_ID,
      });
      const pill = getPill(/chatCitationExcluded/);
      expect(pill.getAttribute("data-citation-state")).toBe("excluded");
    });

    it("excluded pill is still clickable (links still resolve)", () => {
      renderCitation({
        index: 3,
        paper: mkPaper({ included: false }),
        jobId: JOB_ID,
      });
      const pill = getPill(/chatCitationExcluded/);
      expect(pill.tagName).toBe("A");
      expect(pill.getAttribute("href")).toBe(
        "https://openalex.org/W1234567890",
      );
    });

    it("unresolved pill text is '[N]?' (not '[N]') and carries unresolved state", () => {
      renderCitation({ index: 12, paper: null, jobId: JOB_ID });
      const el = screen.getByText("12?");
      expect(el.getAttribute("data-citation-state")).toBe("unresolved");
    });

    it("excluded aria-label uses the excluded variant", () => {
      renderCitation({
        index: 3,
        paper: mkPaper({ included: false, title: "Paper X" }),
        jobId: JOB_ID,
      });
      expect(getPill(/chatCitationExcluded/).getAttribute("aria-label"))
        .toContain("Paper X");
    });
  });

  describe("re-include hover action", () => {
    it("shows the Re-include button in the hover card when excluded", async () => {
      renderCitation({
        index: 3,
        paper: mkPaper({ included: false }),
        jobId: JOB_ID,
      });
      await openHoverCard(/chatCitationExcluded/);
      const btn = document.querySelector(
        "[data-reinclude-action]",
      ) as HTMLElement | null;
      expect(btn).not.toBeNull();
    });

    it("hides the Re-include button when the pill is included", async () => {
      renderCitation({
        index: 3,
        paper: mkPaper({ included: true }),
        jobId: JOB_ID,
      });
      await openHoverCard();
      expect(
        document.querySelector("[data-reinclude-action]"),
      ).toBeNull();
    });

    it("clicking Re-include calls toggleChatPaper({chatPaperId, included: true})", async () => {
      const user = userEvent.setup();
      const paper = mkPaper({
        included: false,
        chatPaperId: "cp_xyz" as Id<"chatPapers">,
      });
      renderCitation({ index: 3, paper, jobId: JOB_ID });
      await openHoverCard(/chatCitationExcluded/);
      const btn = document.querySelector(
        "[data-reinclude-action]",
      ) as HTMLButtonElement;
      await user.click(btn);
      expect(toggleSpy).toHaveBeenCalledWith({
        chatPaperId: "cp_xyz",
        included: true,
      });
    });
  });
});
