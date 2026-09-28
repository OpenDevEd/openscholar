/**
 * @vitest-environment jsdom
 */
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_PROVIDER_CREDENTIAL_KEY } from "@/lib/evidence-libraries/configuration/ai";
import { TEST_AI_MODELS } from "@/lib/evidence-libraries/configuration/test-models";
import {
  draftResult,
  harness,
  mutationMock,
  queryMock,
  renderWorkspace,
  resetWorkspace,
  savedRows,
} from "./harness";

describe("<ConfigurationWorkspace>", () => {
  let saved: unknown[];
  let activated: unknown[];

  beforeEach(() => {
    ({ saved, activated } = resetWorkspace());
  });

  describe("the AI card", () => {
    const card = (key: string) => within(document.getElementById(`sec-${key}`)!);

    it("sits under Discovery in the rail with its state", async () => {
      await renderWorkspace();
      const discovery = within(
        screen.getByRole("navigation", { name: "rail.aria" }),
      );
      const link = discovery.getByRole("link", { name: /sections\.ai/ });
      expect(link).toHaveAttribute("href", "#sec-ai");
      expect(within(link).getByRole("img")).toHaveAccessibleName(
        "sectionState.complete",
      );
      expect(card("ai").getByRole("switch", { name: "ai.answersLabel" })).toBeInTheDocument();
    });

    it(
      "asks for a key and a model, then saves one provider entry",
      async () => {
        const user = userEvent.setup();
        const keysWritten: unknown[] = [];
        mutationMock.mockImplementation((reference: unknown) => {
          if (reference === "saveDraftSections") {
            return async (input: unknown) => {
              saved.push(input);
              return { editVersion: 5 };
            };
          }
          if (reference === "writeCredential") {
            return async (input: unknown) => {
              keysWritten.push(input);
              harness.storedCredentials = [
                { credentialKey: AI_PROVIDER_CREDENTIAL_KEY },
              ];
              return "credential_1";
            };
          }
          return async () => null;
        });
        await renderWorkspace();
        const ai = card("ai");
        await user.click(ai.getByRole("switch", { name: "ai.answersLabel" }));
        expect(ai.getByText("sectionState.attention")).toBeInTheDocument();
        expect(ai.getByText("problems.aiKey")).toBeInTheDocument();
        expect(ai.getByText("problems.aiModel")).toBeInTheDocument();

        await user.type(ai.getByLabelText("ai.keyLabel"), "sk-or-v1-test");
        await user.click(ai.getByRole("button", { name: "ai.keySave" }));
        await waitFor(() =>
          expect(keysWritten).toEqual([
            {
              libraryId: "library_123",
              concretePath: "/ai/providers/0/apiKey",
              instanceKey: "openrouter",
              value: "sk-or-v1-test",
            },
          ]),
        );

        const syncedModel = "meta-llama/llama-4-maverick";
        await user.click(ai.getByRole("button", { name: "ai.addModel" }));
        await user.click(
          await screen.findByRole("option", { name: new RegExp(syncedModel) }),
        );
        await user.click(ai.getByRole("button", { name: "ai.addModel" }));
        await user.click(
          await screen.findByRole("option", {
            name: new RegExp(TEST_AI_MODELS[1]!),
          }),
        );
        await user.click(ai.getByRole("combobox", { name: "ai.modelLabel" }));
        await user.click(
          await screen.findByRole("option", { name: TEST_AI_MODELS[1] }),
        );
        await user.click(screen.getByRole("button", { name: "save" }));

        await waitFor(() => expect(saved).toHaveLength(1));
        const request = saved[0] as { sections: { sectionKey: string; payload: unknown }[] };
        expect(request.sections.find((row) => row.sectionKey === "ai")).toEqual(
          {
            sectionKey: "ai",
            payload: {
              providers: [
                {
                  provider: "openrouter",
                  enabled: true,
                  models: [syncedModel, TEST_AI_MODELS[1]],
                  defaultModel: TEST_AI_MODELS[1],
                },
              ],
            },
          },
        );
        expect(request.sections.find((row) => row.sectionKey === "features")?.payload)
          .toMatchObject({ ai: true });
      },
    );

    it(
      "shows a stored key as saved and lets the owner remove it",
      async () => {
        const user = userEvent.setup();
        harness.storedCredentials = [{ credentialKey: AI_PROVIDER_CREDENTIAL_KEY }];
        const removed: unknown[] = [];
        mutationMock.mockImplementation((reference: unknown) =>
          reference === "removeAiProviderKey"
            ? async (input: unknown) => {
                removed.push(input);
                harness.storedCredentials = [];
                return null;
              }
            : async () => null,
        );
        await renderWorkspace();
        const ai = card("ai");
        await user.click(ai.getByRole("switch", { name: "ai.answersLabel" }));
        expect(ai.getByText("ai.keyStored")).toBeInTheDocument();
        expect(ai.queryByText("problems.aiKey")).not.toBeInTheDocument();

        await user.click(ai.getByRole("button", { name: "ai.keyRemove" }));
        await waitFor(() =>
          expect(removed).toEqual([{ libraryId: "library_123" }]),
        );
        // Convex answers the removal with an empty credential list. That is
        // what puts the key field back and the card into needs attention.
        cleanup();
        queryMock.mockReturnValue(
          draftResult({
            sections: savedRows.map((row) =>
              row.sectionKey === "features"
                ? { sectionKey: "features", payload: { ai: true } }
                : row,
            ),
          }),
        );
        await renderWorkspace();
        const afterRemoval = card("ai");
        expect(afterRemoval.getByText("sectionState.attention")).toBeInTheDocument();
        expect(afterRemoval.getByText("problems.aiKey")).toBeInTheDocument();
        expect(afterRemoval.getByLabelText("ai.keyLabel")).toBeInTheDocument();
      },
    );
  });

  describe("the AI card while a key request is in flight", () => {
    const card = (key: string) => within(document.getElementById(`sec-${key}`)!);

    it("locks every key control until the save answers", async () => {
      const user = userEvent.setup();
      let release!: (id: string) => void;
      mutationMock.mockImplementation((reference: unknown) =>
        reference === "writeCredential"
          ? () =>
              new Promise<string>((resolve) => {
                release = resolve;
              })
          : async () => null,
      );
      await renderWorkspace();
      const ai = card("ai");
      await user.click(ai.getByRole("switch", { name: "ai.answersLabel" }));
      await user.type(ai.getByLabelText("ai.keyLabel"), "sk-or-v1-pending");
      await user.click(ai.getByRole("button", { name: "ai.keySave" }));

      // While the platform is still answering, nothing about the key moves.
      const save = ai.getByRole("button", { name: "ai.keySave" });
      expect(ai.getByLabelText("ai.keyLabel")).toBeDisabled();
      expect(save).toBeDisabled();
      expect(save).toHaveAttribute("aria-busy", "true");

      await act(async () => {
        release("credential_1");
      });
      // The saved key is cleared from the box, so Save has nothing to send.
      expect(save).not.toHaveAttribute("aria-busy");
      expect(ai.getByLabelText("ai.keyLabel")).toBeEnabled();
      expect(ai.getByLabelText("ai.keyLabel")).toHaveValue("");
    });

    it("locks every key control until the removal answers", async () => {
      const user = userEvent.setup();
      harness.storedCredentials = [{ credentialKey: AI_PROVIDER_CREDENTIAL_KEY }];
      let release!: () => void;
      mutationMock.mockImplementation((reference: unknown) =>
        reference === "removeAiProviderKey"
          ? () =>
              new Promise<null>((resolve) => {
                release = () => resolve(null);
              })
          : async () => null,
      );
      await renderWorkspace();
      const ai = card("ai");
      await user.click(ai.getByRole("switch", { name: "ai.answersLabel" }));
      await user.click(ai.getByRole("button", { name: "ai.keyRemove" }));

      const removeButton = ai.getByRole("button", { name: "ai.keyRemove" });
      const replace = ai.getByRole("button", { name: "ai.keyReplace" });
      expect(removeButton).toBeDisabled();
      expect(removeButton).toHaveAttribute("aria-busy", "true");
      // Replace would start a second request against the same row.
      expect(replace).toBeDisabled();

      await act(async () => {
        release();
      });
      expect(ai.getByRole("button", { name: "ai.keyReplace" })).toBeEnabled();
    });

    it("locks Cancel while a replacement is being saved", async () => {
      const user = userEvent.setup();
      harness.storedCredentials = [{ credentialKey: AI_PROVIDER_CREDENTIAL_KEY }];
      let release!: (id: string) => void;
      mutationMock.mockImplementation((reference: unknown) =>
        reference === "writeCredential"
          ? () =>
              new Promise<string>((resolve) => {
                release = resolve;
              })
          : async () => null,
      );
      await renderWorkspace();
      const ai = card("ai");
      await user.click(ai.getByRole("switch", { name: "ai.answersLabel" }));
      await user.click(ai.getByRole("button", { name: "ai.keyReplace" }));
      await user.type(ai.getByLabelText("ai.keyLabel"), "sk-or-v1-replacement");
      await user.click(ai.getByRole("button", { name: "ai.keySave" }));

      expect(ai.getByRole("button", { name: "ai.keyCancel" })).toBeDisabled();

      await act(async () => {
        release("credential_2");
      });
    });
  });

  describe("the AI card without a stored key", () => {
    it("needs attention while AI answers are on and no key is stored", async () => {
      queryMock.mockReturnValue(
        draftResult({
          sections: savedRows.map((row) =>
            row.sectionKey === "features"
              ? { sectionKey: "features", payload: { ai: true } }
              : row,
          ),
        }),
      );
      await renderWorkspace();
      const ai = within(document.getElementById("sec-ai")!);
      expect(ai.getByText("sectionState.attention")).toBeInTheDocument();
      expect(ai.getByText("problems.aiKey")).toBeInTheDocument();
      expect(ai.getByLabelText("ai.keyLabel")).toBeInTheDocument();
    });
  });

  describe("replaced files", () => {
    const newLogo = "https://assets.example.test/logo-light-2.png";
    let removed: unknown[];

    beforeEach(() => {
      removed = [];
      mutationMock.mockImplementation((reference: unknown) => {
        if (reference === "saveDraftSections") {
          return async (input: unknown) => {
            saved.push(input);
            return { editVersion: 5 };
          };
        }
        if (reference === "generateUploadUrl") return async () => "https://upload.example.test/put";
        if (reference === "upload") {
          return async () => ({ kind: "file", bytes: 3, contentType: "image/png", name: "logo.png", url: newLogo });
        }
        if (reference === "remove") {
          return async (input: unknown) => {
            removed.push(input);
            return null;
          };
        }
        return async () => null;
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify({ storageId: "storage_1" }), { status: 200 })),
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    async function replaceLogo(user: ReturnType<typeof userEvent.setup>) {
      const theme = within(document.getElementById("sec-theme")!);
      await user.upload(
        theme.getByLabelText("theme.logoLightLabel"),
        new File(["png"], "logo.png", { type: "image/png" }),
      );
      await waitFor(() => expect(theme.getByText("logo-light-2.png")).toBeInTheDocument());
      return theme;
    }

    it("keeps the saved file when the owner replaces it and then resets", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      const theme = await replaceLogo(user);
      expect(removed).toEqual([]);

      await user.click(theme.getByRole("button", { name: "fields.reset" }));

      expect(theme.getByText("logo-light.svg")).toBeInTheDocument();
      expect(removed).toEqual([]);
    });

    it("deletes the replaced file only after a successful save", async () => {
      const user = userEvent.setup();
      await renderWorkspace();
      await replaceLogo(user);

      await user.click(screen.getByRole("button", { name: "save" }));

      await waitFor(() => expect(saved).toHaveLength(1));
      await waitFor(() =>
        expect(removed).toEqual([
          { libraryId: "library_123", url: "https://assets.example.test/logo-light.svg" },
        ]),
      );
    });
  });
});
