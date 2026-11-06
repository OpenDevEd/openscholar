import { create } from "zustand";

/**
 * The query AI wrote for a question in the address: null while it writes, empty if it couldn't.
 * The initializer sets it and the stage in front of the page reads it.
 */
export const useQuestionStage = create<{ query: string | null }>(() => ({ query: null }));
