/** @vitest-environment jsdom */
import { NextIntlClientProvider } from "next-intl";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DetailsStep } from "@/components/reports/details-step";
import { TooltipProvider } from "@/components/ui/tooltip";
import { blankDetails } from "@/lib/reports/report";
import messages from "@/messages/en-US.json";

vi.hoisted(() => vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://details-test.convex.cloud"));
vi.mock("server-only", () => ({}));
// The form only calls the abstract writer when its button is pressed.
vi.mock("convex/react", async (actual) => ({ ...(await actual<typeof import("convex/react")>()), useAction: () => vi.fn() }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const opened = { ...blankDetails("report.pdf", "2026-11-11"), citations: [{ text: "Smith (2020). Old title." }, { text: "", doi: "10.1234/abc" }], references: ["10.1234/abc"] };

it("corrects a reference in its row with Enter, and Escape leaves it as it was", () => {
  vi.useFakeTimers();
  const onSave = vi.fn();
  render(
    <NextIntlClientProvider locale="en-US" messages={messages}>
      <TooltipProvider>
        <DetailsStep initial={opened} onRun={async () => {}} onSave={onSave} />
      </TooltipProvider>
    </NextIntlClientProvider>,
  );

  fireEvent.click(screen.getByRole("button", { name: "Edit reference 2" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Reference 2" }), { target: { value: "Doe (2021). A study. https://doi.org/10.1234/ABC." } });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Reference 2" }), { key: "Escape" });
  expect(screen.queryByRole("textbox", { name: "Reference 2" })).toBeNull();
  act(() => vi.runAllTimers());
  expect(onSave).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Edit reference 2" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Reference 2" }), { target: { value: "Doe (2021). A study. https://doi.org/10.1234/ABC." } });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Reference 2" }), { key: "Enter" });
  act(() => vi.runAllTimers());
  expect(onSave).toHaveBeenLastCalledWith(
    { citations: [{ text: "Smith (2020). Old title." }, { text: "Doe (2021). A study. https://doi.org/10.1234/ABC.", doi: "10.1234/abc" }], references: ["10.1234/abc"] },
    undefined,
  );
});
