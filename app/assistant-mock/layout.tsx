import type { ReactNode } from "react";
import { AssistantMock } from "@/components/assistant-mock/assistant-mock";

export const metadata = { title: "Assistant mock" };

/** The assistant lives in the layout, so it stays with the user from page to page. */
export default function AssistantMockLayout({ children }: { children: ReactNode }) {
  return <AssistantMock>{children}</AssistantMock>;
}
