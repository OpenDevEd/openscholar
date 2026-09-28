/**
 * @vitest-environment jsdom
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fillField,
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

  describe("content sections", () => {
    const card = (key: string) => within(document.getElementById(`sec-${key}`)!);

    async function choose(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement, option: string) {
      await user.click(trigger);
      await user.click(await screen.findByRole("option", { name: option }));
    }

    it("writes the top bar search switch to the features row", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      await user.click(card("navigation").getByRole("switch", { name: "navigation.showSearch" }));
      expect(card("navigation").getByText("sectionState.edited")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "save" }));

      await waitFor(() => expect(saved).toHaveLength(1));
      const request = saved[0] as { sections: { sectionKey: string; payload: unknown }[] };
      expect(request.sections.map((row) => row.sectionKey)).toEqual(["features"]);
      expect(request.sections[0]?.payload).toMatchObject({
        navbarSearch: false,
        collections: true,
        downloads: false,
      });
    });

    it("adds someone without an account, whose picture is where their photo goes", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      const home = card("home");
      await user.click(home.getByRole("switch", { name: "Show a home page" }));
      await user.click(home.getByRole("button", { name: "Add someone" }));
      expect(home.getByText("Added by hand. Click the picture to add a photo.")).toBeInTheDocument();
      await user.type(home.getByLabelText("Name"), "Amina Yusuf");
      expect(home.getByRole("button", { name: "Add a photo of Amina Yusuf" })).toBeInTheDocument();
      expect(home.queryByRole("button", { name: /Remove the photo/ })).toBeNull();
    });

    it("names the publication picker with its field label", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      await user.click(card("home").getByRole("switch", { name: "Show a home page" }));
      await user.click(card("home").getByRole("button", { name: "Add step" }));
      expect(card("home").getByLabelText("Publication followed").tagName).toBe("BUTTON");
    });

    it("shows the Home card and writes its switch to the features row", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      const home = card("home");
      expect(home.getByText("sections.home")).toBeInTheDocument();
      expect(home.getByText("sectionState.complete")).toBeInTheDocument();
      // Off, the card shows only its switch, as the other switched cards do.
      expect(home.queryByLabelText(/Example question/)).toBeNull();
      expect(home.queryByRole("button", { name: "Add step" })).toBeNull();

      await user.click(home.getByRole("switch", { name: "Show a home page" }));
      expect(await home.findAllByLabelText(/Example question/)).not.toHaveLength(0);
      expect(home.getAllByLabelText(/Example question/)[0]).toHaveAttribute(
        "placeholder",
        "What does the evidence say about literacy?",
      );
      // A slot the library has no question for shows a fallback of its own.
      const fallback = home.getAllByLabelText(/Example question/)[1]!.getAttribute("placeholder");
      expect(fallback).toBeTruthy();
      expect(fallback).not.toBe("What does the evidence say about literacy?");

      expect(home.getByText("sectionState.edited")).toBeInTheDocument();
      expect(card("features").getByText("sectionState.complete")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "save" }));

      await waitFor(() => expect(saved).toHaveLength(1));
      const request = saved[0] as { sections: { sectionKey: string; payload: unknown }[] };
      expect(request.sections.map((row) => row.sectionKey)).toEqual(["features"]);
      expect(request.sections[0]?.payload).toMatchObject({ homePage: true });
    });

    it("asks for an address once a link goes to an external site", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      const navigation = card("navigation");
      await user.click(navigation.getByRole("button", { name: "navigation.addLink" }));
      const row = within(document.querySelector("[data-nav-link]") as HTMLElement);
      expect(row.getByRole("alert")).toHaveTextContent("links.labelError");
      await fillField(user, row.getByLabelText("links.labelLabel"), "About");

      await choose(user, row.getByRole("combobox", { name: "links.kindLabel" }), "links.kinds.url");
      await fillField(user, row.getByLabelText("links.urlLabel"), "https://example.org/about");
      expect(row.getByRole("switch", { name: "links.newTab" })).toBeInTheDocument();
      expect(navigation.getByText("sectionState.edited")).toBeInTheDocument();
    });

    it("clears the other target when a link changes what it goes to", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      const navigation = card("navigation");
      await user.click(navigation.getByRole("button", { name: "navigation.addLink" }));
      const row = within(document.querySelector("[data-nav-link]") as HTMLElement);
      await fillField(user, row.getByLabelText("links.labelLabel"), "About");
      await choose(user, row.getByRole("combobox", { name: "links.kindLabel" }), "links.kinds.url");
      await fillField(user, row.getByLabelText("links.urlLabel"), "https://example.org/about");

      await choose(user, row.getByRole("combobox", { name: "links.kindLabel" }), "links.kinds.page");
      expect(row.queryByLabelText("links.urlLabel")).not.toBeInTheDocument();
      expect(row.queryByRole("switch", { name: "links.newTab" })).not.toBeInTheDocument();
      expect(row.getByRole("combobox", { name: "links.pageLabel" })).toHaveTextContent("links.pages.home");

      await choose(user, row.getByRole("combobox", { name: "links.kindLabel" }), "links.kinds.url");
      expect(row.getByLabelText("links.urlLabel")).toHaveValue("");
      expect(row.getByRole("alert")).toHaveTextContent("links.urlError");
      expect(navigation.getByText("sectionState.attention")).toBeInTheDocument();
    });

    it("keeps the OpenScholar credit switched on", async () => {
      await renderWorkspace();
      const credit = card("footer").getByRole("switch", { name: "footer.poweredBy" });
      expect(credit).toBeChecked();
      expect(credit).toBeDisabled();
    });

    it("shows a recipient field only while its switch is on and saves nothing when off", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      const contact = card("contact");
      const contactForm = contact.getByRole("switch", { name: "contact.contactRecipientLabel" });
      const takedown = contact.getByRole("switch", { name: "contact.takedownRecipientLabel" });
      expect(contactForm).not.toBeChecked();
      expect(contact.queryByLabelText("contact.contactRecipient")).not.toBeInTheDocument();
      expect(takedown).toBeChecked();
      expect(contact.getByLabelText("contact.takedownRecipient")).toHaveValue("takedown@example.org");

      await user.click(contactForm);
      expect(contact.getByText("sectionState.attention")).toBeInTheDocument();
      await fillField(user, contact.getByLabelText("contact.contactRecipient"), "team@example.org");
      expect(contact.getByText("sectionState.edited")).toBeInTheDocument();

      await user.click(takedown);
      expect(contact.queryByLabelText("contact.takedownRecipient")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "save" }));
      await waitFor(() => expect(saved).toHaveLength(1));
      const request = saved[0] as { sections: { sectionKey: string; payload: unknown }[] };
      expect(request.sections).toEqual([
        { sectionKey: "email", payload: { contactRecipient: "team@example.org" } },
      ]);
    });

    it("switches a legal page between an address and uploaded text, then saves the text", async () => {
      const user = userEvent.setup();
      mutationMock.mockImplementation((reference: unknown) => {
        if (reference === "saveDraftSections") {
          return async (input: unknown) => {
            saved.push(input);
            return { editVersion: 5 };
          };
        }
        if (reference === "generateUploadUrl") return async () => "https://upload.example.test/put";
        if (reference === "upload") {
          return async () => ({ kind: "text", bytes: 20, name: "privacy.md", text: "# Privacy\n\nWe keep little." });
        }
        return async () => null;
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify({ storageId: "storage_1" }), { status: 200 })),
      );
      try {
        await renderWorkspace();
        const privacy = document.querySelector("[data-legal='privacy']") as HTMLElement;
        expect(privacy).toHaveAttribute("data-legal-kind", "none");

        await user.click(within(privacy).getByRole("tab", { name: "contact.legalKinds.url" }));
        expect(privacy).toHaveAttribute("data-legal-kind", "url");
        await fillField(user, within(privacy).getByLabelText("contact.legalUrl"), "https://example.org/privacy");

        await user.click(within(privacy).getByRole("tab", { name: "contact.legalKinds.text" }));
        expect(privacy).toHaveAttribute("data-legal-kind", "text");
        expect(within(privacy).queryByLabelText("contact.legalUrl")).not.toBeInTheDocument();
        expect(within(privacy).getByRole("alert")).toHaveTextContent("fields.required");

        await user.upload(
          within(privacy).getByLabelText("contact.legalFile"),
          new File(["# Privacy"], "privacy.md", { type: "text/markdown" }),
        );
        await within(privacy).findByText("Privacy");
        expect(within(privacy).getByRole("button", { name: "fields.view" })).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "save" }));
        await waitFor(() => expect(saved).toHaveLength(1));
        const request = saved[0] as { sections: { sectionKey: string; payload: unknown }[] };
        expect(request.sections).toEqual([
          { sectionKey: "legal", payload: { privacyMarkdown: "# Privacy\n\nWe keep little." } },
        ]);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
