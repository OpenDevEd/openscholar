/**
 * @vitest-environment jsdom
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import {
  mutationMock,
  renderWorkspace,
  resetWorkspace,
} from "./harness";

describe("<ConfigurationWorkspace>", () => {
  let saved: unknown[];
  let activated: unknown[];

  beforeEach(() => {
    ({ saved, activated } = resetWorkspace());
  });

  describe("discovery sections", () => {
    const card = (key: string) => within(document.getElementById(`sec-${key}`)!);

    it("drops the full-text scope when full-text search is turned off and saves the search row", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      const search = card("search");
      const documents = search.getByRole("checkbox", { name: "search.scope.documents" });
      expect(documents).toBeChecked();
      await user.click(search.getByRole("switch", { name: "search.fullText" }));
      expect(documents).toBeDisabled();
      expect(documents).not.toBeChecked();
      await user.click(screen.getByRole("button", { name: "save" }));

      await waitFor(() => expect(saved).toHaveLength(1));
      const request = saved[0] as { sections: { sectionKey: string; payload: unknown }[] };
      expect(request.sections.map((row) => row.sectionKey)).toEqual(["search"]);
      expect(request.sections[0]?.payload).toMatchObject({ fullText: false });
      expect((request.sections[0]?.payload as { scopes: string[] }).scopes).not.toContain("documents");
    });

    it("asks for a pinned institution only in the featured mode", async () => {
      const user = userEvent.setup();
      mutationMock.mockImplementation((reference: unknown) =>
        reference === "listInstitutions"
          ? async () => ({ reason: "not-set-up", page: [], isDone: true, continueCursor: "" })
          : async () => null,
      );
      await renderWorkspace();
      const search = card("search");
      expect(search.queryByRole("combobox", { name: "search.featuredInstitution" })).not.toBeInTheDocument();
      await user.click(search.getByRole("combobox", { name: "search.institutionMode" }));
      await user.click(await screen.findByRole("option", { name: "search.institutionModes.facet-with-featured-value" }));
      expect(search.getByText("sectionState.attention")).toBeInTheDocument();
      expect(search.getByRole("alert")).toHaveTextContent("search.featuredInstitutionError");
      await user.click(search.getByRole("combobox", { name: "search.featuredInstitution" }));
      expect(await screen.findByText("evidenceLibraryInstitutions.picker.notSetUp")).toBeInTheDocument();
    });

    it("shows the Zotero sources and the collections picker inside their cards", async () => {
      await renderWorkspace();
      expect(card("sources").getByRole("button", { name: "sources.addSource" })).toBeInTheDocument();
      expect(await card("collections").findByRole("button", { name: "collections.picker.open" })).toBeInTheDocument();
      expect(card("institutions").getByRole("combobox", { name: "institutions.nameLabel" })).toBeInTheDocument();
    });
  });

  describe("platform sections", () => {
    const card = (key: string) => within(document.getElementById(`sec-${key}`)!);

    it("disables a feature with the reason and switches it off again when its export goes", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      const features = card("features");
      const downloads = features.getByRole("switch", { name: "features.labels.downloads" });
      const ris = card("citations").getByRole("switch", { name: "citations.formats.ris" });
      const bibtex = card("citations").getByRole("switch", { name: "citations.formats.bibtex" });
      expect(downloads).toBeEnabled();
      await user.click(downloads);
      expect(downloads).toBeChecked();

      await user.click(ris);
      await user.click(bibtex);
      expect(downloads).toBeDisabled();
      expect(downloads).not.toBeChecked();
      expect(features.getByText("features.needsExports")).toBeInTheDocument();
      expect(features.getByText("sectionState.complete")).toBeInTheDocument();
    });

    it("saves the Atom feed switch and unlocks the Atom feed link", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      const atomLink = card("features").getByRole("switch", { name: "features.labels.atomFeed" });
      expect(atomLink).toBeDisabled();
      await user.click(card("citations").getByRole("switch", { name: "citations.formats.atom" }));
      expect(atomLink).toBeEnabled();
      await user.click(screen.getByRole("button", { name: "save" }));
      await waitFor(() => expect(saved).toHaveLength(1));
      const request = saved[0] as { sections: { sectionKey: string; payload: unknown }[] };
      expect(request.sections).toEqual([
        { sectionKey: "exports", payload: { ris: true, bibtex: true, atom: true } },
      ]);
    });

    it("keeps the language switch off until two languages are offered", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      const languageSwitch = card("features").getByRole("switch", { name: "features.labels.languageSwitcher" });
      expect(languageSwitch).toBeDisabled();
      await user.click(card("languages").getByRole("checkbox", { name: "languages.names.fr" }));
      expect(languageSwitch).toBeEnabled();
      expect(card("languages").getByText("sectionState.edited")).toBeInTheDocument();
    });

    it("asks for a measurement id as soon as Google Analytics is switched on", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      const analytics = card("analytics");
      expect(analytics.queryByLabelText("analytics.measurementIdLabel")).not.toBeInTheDocument();
      await user.click(analytics.getByRole("switch", { name: "analytics.googleLabel" }));
      expect(analytics.getByText("sectionState.attention")).toBeInTheDocument();
      await user.type(analytics.getByLabelText("analytics.measurementIdLabel"), "g-abcd12");
      expect(analytics.getByText("sectionState.edited")).toBeInTheDocument();
    });

    it("saves PostHog and Google Analytics switched on together", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      const analytics = card("analytics");
      // Pasted rather than typed: the page re-renders on every keystroke, and
      // what this test is about is what Save sends, not per-character state.
      const fill = async (label: string, value: string) => {
        await user.click(analytics.getByLabelText(label));
        await user.paste(value);
      };
      await user.click(analytics.getByRole("switch", { name: "analytics.googleLabel" }));
      await fill("analytics.measurementIdLabel", "g-abcd12");
      await user.click(analytics.getByRole("switch", { name: "analytics.posthogLabel" }));
      expect(analytics.getByText("sectionState.attention")).toBeInTheDocument();
      await fill("analytics.hostLabel", "https://eu.i.posthog.com");
      await fill("analytics.keyLabel", "phc_12345678901234567890");
      expect(analytics.getByText("sectionState.edited")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "save" }));
      await waitFor(() => expect(saved).toHaveLength(1));
      const request = saved[0] as { sections: { sectionKey: string; payload: unknown }[] };
      expect(request.sections).toEqual([
        {
          sectionKey: "analytics",
          payload: {
            posthog: { host: "https://eu.i.posthog.com", key: "phc_12345678901234567890" },
            google: { measurementId: "G-ABCD12" },
          },
        },
      ]);
    });
  });

  describe("the analytics fields the runtime gained", () => {
    const card = (key: string) => within(document.getElementById(`sec-${key}`)!);

    it(
      "offers the session recordings address only once a host is set",
      async () => {
        const user = userEvent.setup();
        await renderWorkspace();
        const analytics = card("analytics");
        expect(analytics.queryByLabelText("analytics.uiHostLabel")).not.toBeInTheDocument();

        // Switched on with no host yet: the card needs attention and the
        // recordings address is still nowhere to be seen.
        await user.click(analytics.getByRole("switch", { name: "analytics.posthogLabel" }));
        expect(analytics.getByText("sectionState.attention")).toBeInTheDocument();
        expect(analytics.getByText("problems.posthog")).toBeInTheDocument();
        expect(analytics.queryByLabelText("analytics.uiHostLabel")).not.toBeInTheDocument();

        // This checks field visibility and validation after editing, not individual keystrokes.
        await user.click(analytics.getByLabelText("analytics.hostLabel"));
        await user.paste("https://eu.i.posthog.com");
        await user.click(analytics.getByLabelText("analytics.keyLabel"));
        await user.paste("phc_12345678901234567890");
        await user.click(analytics.getByLabelText("analytics.uiHostLabel"));
        await user.paste("not-an-address");
        expect(analytics.getByText("problems.posthogUiHost")).toBeInTheDocument();
        expect(analytics.getByText("sectionState.attention")).toBeInTheDocument();

        // Clearing the host takes the recordings address with it, so the two
        // can never be saved half-set.
        await user.clear(analytics.getByLabelText("analytics.hostLabel"));
        expect(analytics.queryByLabelText("analytics.uiHostLabel")).not.toBeInTheDocument();
        expect(analytics.queryByText("problems.posthogUiHost")).not.toBeInTheDocument();
        await user.click(analytics.getByLabelText("analytics.hostLabel"));
        await user.paste("https://eu.i.posthog.com");
        expect(analytics.getByLabelText("analytics.uiHostLabel")).toHaveValue("");
      },
    );

    it(
      "saves a raised consent version and refuses one below one",
      async () => {
        const user = userEvent.setup();
        await renderWorkspace();
        const analytics = card("analytics");
        const version = analytics.getByLabelText("analytics.consentVersionLabel");
        await user.clear(version);
        await user.type(version, "0");
        expect(analytics.getByText("problems.consentVersion")).toBeInTheDocument();
        await user.clear(version);
        await user.type(version, "3");
        await user.click(screen.getByRole("button", { name: "save" }));
        await waitFor(() => expect(saved).toHaveLength(1));
        const request = saved[0] as { sections: { sectionKey: string; payload: unknown }[] };
        expect(request.sections).toEqual([
          { sectionKey: "analytics", payload: { consentPolicyVersion: 3 } },
        ]);
      },
    );
  });
});
