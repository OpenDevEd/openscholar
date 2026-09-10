import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import { ModelPicker } from "@/components/extraction/model-picker";

const { models } = vi.hoisted(() => ({models: vi.fn()}));
vi.mock("convex/react", () => ({useQuery: models}));
vi.mock("next-intl", () => ({useTranslations: () => (key: string) => ({modelPickerLabel: "Chat model", modelPickerPlaceholder: "Select a model"})[key]}));

describe("model picker retirement", () => {
  it("shows the selection prompt when a saved model retires without silently choosing a replacement", () => {
    const id = "old-model" as Id<"models">;
    models.mockReturnValue([{_id: id, modelId: "provider/old", name: "Old model", provider: "Provider", sortOrder: 1}]);
    const onChange = vi.fn();
    const {rerender} = render(<ModelPicker value={id} onChange={onChange} />);
    expect(screen.getByRole("combobox", {name: "Chat model"})).toHaveTextContent("Old model");
    models.mockReturnValue([{_id: "new-model", modelId: "provider/new", name: "New model", provider: "Provider", sortOrder: 1}]);
    rerender(<ModelPicker value={id} onChange={onChange} />);
    expect(screen.getByRole("combobox", {name: "Chat model"})).toHaveTextContent("Select a model");
    expect(onChange).not.toHaveBeenCalled();
  });
});
