/** @vitest-environment jsdom */
import { NextIntlClientProvider } from "next-intl";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DetailsStep } from "@/components/reports/details-step";
import { TooltipProvider } from "@/components/ui/tooltip";
import { blankDetails, type Metadata } from "@/lib/reports/report";
import messages from "@/messages/en-US.json";

vi.hoisted(() => vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://details-test.convex.cloud"));
vi.mock("server-only", () => ({}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const form = (initial: Metadata, onSave: (m: Metadata) => void) => (
  <NextIntlClientProvider locale="en-US" messages={messages}>
    <TooltipProvider>
      <DetailsStep initial={initial} onRun={async () => {}} onSave={onSave} />
    </TooltipProvider>
  </NextIntlClientProvider>
);

// Two tabs on one report: a title saved in the other tab reaches this form as its new `initial`. Editing only the
// subtitle here must save that newer title, not the one this form opened with.
it("keeps a title saved in another tab when this tab saves another field", () => {
  vi.useFakeTimers();
  const onSave = vi.fn();
  const opened = { ...blankDetails("report.pdf", "2026-11-11"), title: "Old title" };
  const view = render(form(opened, onSave));
  view.rerender(form({ ...opened, title: "Title from the other tab" }, onSave));
  expect(screen.getByLabelText(/^Title/)).toHaveProperty("value", "Title from the other tab");

  fireEvent.change(screen.getByLabelText(/^Subtitle/), { target: { value: "Subtitle from this tab" } });
  act(() => vi.runAllTimers());

  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Title from the other tab", subtitle: "Subtitle from this tab" }), undefined);
});
