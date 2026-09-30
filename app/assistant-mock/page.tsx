"use client";

import { ResultsPane } from "@/components/assistant-mock/results-pane";
import { useMock } from "@/components/assistant-mock/context";

export default function AssistantMockResultsPage() {
  const { page, undoSearch } = useMock();
  return <ResultsPane page={page} onUndo={undoSearch} />;
}
