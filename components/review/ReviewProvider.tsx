"use client";

import React, { createContext, useContext, useReducer, useCallback, useEffect, useRef } from "react";
import { SystematicReview, Step, ReviewStatus } from "@/db/schema";
import { SearchTermData, STEP_ORDER, getNextStep, getPreviousStep } from "@/lib/repo";
import {
  getReview,
  saveResearchQuestion,
  generateBooleanSearchTerms,
  saveBooleanSearchTerms,
  generateScreeningQuestions,
  saveScreeningQuestions,
  generateDataExtractionQuestions,
  saveDataExtractionQuestions,
  updateReviewProgress,
  addReviewError,
  updateReviewStep,
  addCustomScreeningQuestion as addCustomScreeningQuestionAction,
  removeScreeningQuestion as removeScreeningQuestionAction,
  editScreeningQuestion as editScreeningQuestionAction,
  addCustomDataExtractionQuestion as addCustomDataExtractionQuestionAction,
  removeDataExtractionQuestion as removeDataExtractionQuestionAction,
  editDataExtractionQuestion as editDataExtractionQuestionAction
} from "../../app/actions/review";

interface ReviewState {
  review: SystematicReview | null;
  currentStep: Step | null;
  isLoading: boolean;
  isSaving: boolean;
  errors: Array<{ message: string; timestamp: Date }>;
  lastSaved: Date | null;
  hasUnsavedChanges: boolean;
  localData: {
    researchQuestion?: string;
    searchTerms?: SearchTermData[];
    screeningQuestions?: string[];
    dataExtractionQuestions?: any[];
  };
}

type ReviewAction =
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_SAVING"; payload: boolean }
  | { type: "SET_REVIEW"; payload: SystematicReview }
  | { type: "UPDATE_LOCAL_DATA"; payload: Partial<ReviewState["localData"]> }
  | { type: "SET_UNSAVED_CHANGES"; payload: boolean }
  | { type: "SET_LAST_SAVED"; payload: Date }
  | { type: "ADD_ERROR"; payload: string }
  | { type: "CLEAR_ERRORS" }
  | { type: "SET_STEP"; payload: Step };

const initialState: ReviewState = {
  review: null,
  currentStep: null,
  isLoading: false,
  isSaving: false,
  errors: [],
  lastSaved: null,
  hasUnsavedChanges: false,
  localData: {},
};

function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case "SET_LOADING":
      return { ...state, isLoading: action.payload };

    case "SET_SAVING":
      return { ...state, isSaving: action.payload };

    case "SET_REVIEW":
      return {
        ...state,
        review: action.payload,
        currentStep: action.payload.currentStep,
        localData: {
          researchQuestion: action.payload.researchQuestion || "",
          searchTerms: action.payload.searchTerms || [],
          screeningQuestions: action.payload.screeningQuestions || [],
          dataExtractionQuestions: action.payload.dataExtractionQuestions || [],
        },
        hasUnsavedChanges: false,
      };

    case "UPDATE_LOCAL_DATA":
      return {
        ...state,
        localData: { ...state.localData, ...action.payload },
        hasUnsavedChanges: true,
      };

    case "SET_UNSAVED_CHANGES":
      return { ...state, hasUnsavedChanges: action.payload };

    case "SET_LAST_SAVED":
      return { ...state, lastSaved: action.payload, hasUnsavedChanges: false };

    case "ADD_ERROR":
      return {
        ...state,
        errors: [...state.errors, { message: action.payload, timestamp: new Date() }],
      };

    case "CLEAR_ERRORS":
      return { ...state, errors: [] };

    case "SET_STEP":
      return { ...state, currentStep: action.payload };

    default:
      return state;
  }
}

interface ReviewContextValue extends ReviewState {
  loadReview: (id: number) => Promise<void>;
  saveResearchQuestion: (question: string) => Promise<void>;
  generateAndSaveSearchTerms: () => Promise<void>;
  generateAndSaveScreeningQuestions: () => Promise<void>;
  generateAndSaveDataExtractionQuestions: () => Promise<void>;
  addCustomScreeningQuestion: (reviewId: number, question: string) => Promise<void>;
  removeScreeningQuestion: (reviewId: number, index: number) => Promise<void>;
  editScreeningQuestion: (reviewId: number, index: number, question: string) => Promise<void>;
  addCustomDataExtractionQuestion: (reviewId: number, question: string, type: 'boolean' | 'string' | 'number' | 'array') => Promise<void>;
  removeDataExtractionQuestion: (reviewId: number, index: number) => Promise<void>;
  editDataExtractionQuestion: (reviewId: number, index: number, question: string, type?: 'boolean' | 'string' | 'number' | 'array') => Promise<void>;
  goToNextStep: () => Promise<void>;
  goToPreviousStep: () => Promise<void>;
  clearErrors: () => void;
  retryLastOperation: () => Promise<void>;
}

const ReviewContext = createContext<ReviewContextValue | null>(null);

export function ReviewProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reviewReducer, initialState);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-save functionality
  useEffect(() => {
    if (state.hasUnsavedChanges && state.review) {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }

      autoSaveTimeoutRef.current = setTimeout(async () => {
        try {
          await performAutoSave();
        } catch (error) {
          console.error("Auto-save failed:", error);
        }
      }, 2000); // Auto-save after 2 seconds of inactivity
    }

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [state.hasUnsavedChanges, state.localData, state.review]);

  const performAutoSave = async () => {
    if (!state.review) return;

    dispatch({ type: "SET_SAVING", payload: true });

    try {
      // Save based on current step and local data
      let updatedReview: SystematicReview | null = null;

      if (state.currentStep === "research_question" && state.localData.researchQuestion) {
        updatedReview = await saveResearchQuestion(state.review.id, state.localData.researchQuestion);
      }

      if (updatedReview) {
        dispatch({ type: "SET_REVIEW", payload: updatedReview });
        dispatch({ type: "SET_LAST_SAVED", payload: new Date() });
      } else {
        // If no changes to save, just mark as saved to clear the unsaved changes flag
        dispatch({ type: "SET_LAST_SAVED", payload: new Date() });
      }
    } catch (error) {
      console.error("Auto-save error:", error);
      dispatch({ type: "ADD_ERROR", payload: "Failed to auto-save changes" });
    } finally {
      dispatch({ type: "SET_SAVING", payload: false });
    }
  };

  const loadReview = useCallback(async (id: number) => {
    dispatch({ type: "SET_LOADING", payload: true });
    dispatch({ type: "CLEAR_ERRORS" });

    try {
      const review = await getReview(id);
      if (review) {
        dispatch({ type: "SET_REVIEW", payload: review });
      } else {
        dispatch({ type: "ADD_ERROR", payload: "Review not found" });
      }
    } catch (error) {
      console.error("Failed to load review:", error);
      dispatch({ type: "ADD_ERROR", payload: "Failed to load review" });
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  }, []);

  const handleSaveResearchQuestion = useCallback(async (question: string) => {
    if (!state.review) return;

    dispatch({ type: "SET_SAVING", payload: true });
    dispatch({ type: "CLEAR_ERRORS" });

    try {
      // Optimistic update
      dispatch({ type: "UPDATE_LOCAL_DATA", payload: { researchQuestion: question } });

      const updatedReview = await saveResearchQuestion(state.review.id, question);
      dispatch({ type: "SET_REVIEW", payload: updatedReview });
      dispatch({ type: "SET_LAST_SAVED", payload: new Date() });

      // Advance to next step will be handled by the component
      return;
    } catch (error) {
      console.error("Failed to save research question:", error);
      dispatch({ type: "ADD_ERROR", payload: "Failed to save research question" });

      // Revert optimistic update on error
      if (state.review) {
        dispatch({ type: "SET_REVIEW", payload: state.review });
      }
    } finally {
      dispatch({ type: "SET_SAVING", payload: false });
    }
  }, [state.review]);

  const generateAndSaveSearchTerms = useCallback(async () => {
    if (!state.review) return;

    dispatch({ type: "SET_SAVING", payload: true });
    dispatch({ type: "CLEAR_ERRORS" });

    try {
      const searchTerms = await generateBooleanSearchTerms(state.review.id);
      const updatedReview = await saveBooleanSearchTerms(state.review.id, searchTerms);

      dispatch({ type: "SET_REVIEW", payload: updatedReview });
      dispatch({ type: "SET_LAST_SAVED", payload: new Date() });

      // Advance to next step will be handled by the component
    } catch (error) {
      console.error("Failed to generate search terms:", error);
      dispatch({ type: "ADD_ERROR", payload: "Failed to generate search terms" });
    } finally {
      dispatch({ type: "SET_SAVING", payload: false });
    }
  }, [state.review]);

  const generateAndSaveScreeningQuestions = useCallback(async () => {
    if (!state.review) return;

    dispatch({ type: "SET_SAVING", payload: true });
    dispatch({ type: "CLEAR_ERRORS" });

    try {
      const screeningQuestions = await generateScreeningQuestions(state.review.id);
      const updatedReview = await saveScreeningQuestions(state.review.id, screeningQuestions);

      dispatch({ type: "SET_REVIEW", payload: updatedReview });
      dispatch({ type: "SET_LAST_SAVED", payload: new Date() });

      // Advance to next step will be handled by the component
    } catch (error) {
      console.error("Failed to generate screening questions:", error);
      dispatch({ type: "ADD_ERROR", payload: "Failed to generate screening questions" });
    } finally {
      dispatch({ type: "SET_SAVING", payload: false });
    }
  }, [state.review]);

  const generateAndSaveDataExtractionQuestions = useCallback(async () => {
    if (!state.review) return;

    dispatch({ type: "SET_SAVING", payload: true });
    dispatch({ type: "CLEAR_ERRORS" });

    try {
      const dataExtractionQuestions = await generateDataExtractionQuestions(state.review.id);
      const updatedReview = await saveDataExtractionQuestions(state.review.id, dataExtractionQuestions);

      dispatch({ type: "SET_REVIEW", payload: updatedReview });
      dispatch({ type: "SET_LAST_SAVED", payload: new Date() });

      // Advance to next step will be handled by the component
    } catch (error) {
      console.error("Failed to generate data extraction questions:", error);
      dispatch({ type: "ADD_ERROR", payload: "Failed to generate data extraction questions" });
    } finally {
      dispatch({ type: "SET_SAVING", payload: false });
    }
  }, [state.review]);

  const addCustomScreeningQuestion = useCallback(async (reviewId: number, question: string) => {
    if (!state.review) return;
    dispatch({ type: "SET_SAVING", payload: true });
    dispatch({ type: "CLEAR_ERRORS" });
    try {
      const updatedReview = await addCustomScreeningQuestionAction(reviewId, question);
      dispatch({ type: "SET_REVIEW", payload: updatedReview });
      dispatch({ type: "SET_LAST_SAVED", payload: new Date() });
    } catch (error) {
      console.error("Failed to add custom screening question:", error);
      dispatch({ type: "ADD_ERROR", payload: "Failed to add custom screening question" });
    } finally {
      dispatch({ type: "SET_SAVING", payload: false });
    }
  }, [state.review]);

  const removeScreeningQuestion = useCallback(async (reviewId: number, index: number) => {
    if (!state.review) return;
    dispatch({ type: "SET_SAVING", payload: true });
    dispatch({ type: "CLEAR_ERRORS" });
    try {
      const updatedReview = await removeScreeningQuestionAction(reviewId, index);
      dispatch({ type: "SET_REVIEW", payload: updatedReview });
      dispatch({ type: "SET_LAST_SAVED", payload: new Date() });
    } catch (error) {
      console.error("Failed to remove screening question:", error);
      dispatch({ type: "ADD_ERROR", payload: "Failed to remove screening question" });
    } finally {
      dispatch({ type: "SET_SAVING", payload: false });
    }
  }, [state.review]);

  const addCustomDataExtractionQuestion = useCallback(async (reviewId: number, question: string, type: 'boolean' | 'string' | 'number' | 'array') => {
    if (!state.review) return;
    dispatch({ type: "SET_SAVING", payload: true });
    dispatch({ type: "CLEAR_ERRORS" });
    try {
      const updatedReview = await addCustomDataExtractionQuestionAction(reviewId, question, type);
      dispatch({ type: "SET_REVIEW", payload: updatedReview });
      dispatch({ type: "SET_LAST_SAVED", payload: new Date() });
    } catch (error) {
      console.error("Failed to add custom data extraction question:", error);
      dispatch({ type: "ADD_ERROR", payload: "Failed to add custom data extraction question" });
    } finally {
      dispatch({ type: "SET_SAVING", payload: false });
    }
  }, [state.review]);

  const removeDataExtractionQuestion = useCallback(async (reviewId: number, index: number) => {
    if (!state.review) return;
    dispatch({ type: "SET_SAVING", payload: true });
    dispatch({ type: "CLEAR_ERRORS" });
    try {
      const updatedReview = await removeDataExtractionQuestionAction(reviewId, index);
      dispatch({ type: "SET_REVIEW", payload: updatedReview });
      dispatch({ type: "SET_LAST_SAVED", payload: new Date() });
    } catch (error) {
      console.error("Failed to remove data extraction question:", error);
      dispatch({ type: "ADD_ERROR", payload: "Failed to remove data extraction question" });
    } finally {
      dispatch({ type: "SET_SAVING", payload: false });
    }
  }, [state.review]);

  const editScreeningQuestion = useCallback(async (reviewId: number, index: number, question: string) => {
    if (!state.review) return;
    dispatch({ type: "SET_SAVING", payload: true });
    dispatch({ type: "CLEAR_ERRORS" });
    try {
      const updatedReview = await editScreeningQuestionAction(reviewId, index, question);
      dispatch({ type: "SET_REVIEW", payload: updatedReview });
      dispatch({ type: "SET_LAST_SAVED", payload: new Date() });
    } catch (error) {
      console.error("Failed to edit screening question:", error);
      dispatch({ type: "ADD_ERROR", payload: "Failed to edit screening question" });
    } finally {
      dispatch({ type: "SET_SAVING", payload: false });
    }
  }, [state.review]);

  const editDataExtractionQuestion = useCallback(async (reviewId: number, index: number, question: string, type?: 'boolean' | 'string' | 'number' | 'array') => {
    if (!state.review) return;
    dispatch({ type: "SET_SAVING", payload: true });
    dispatch({ type: "CLEAR_ERRORS" });
    try {
      const updatedReview = await editDataExtractionQuestionAction(reviewId, index, question, type);
      dispatch({ type: "SET_REVIEW", payload: updatedReview });
      dispatch({ type: "SET_LAST_SAVED", payload: new Date() });
    } catch (error) {
      console.error("Failed to edit data extraction question:", error);
      dispatch({ type: "ADD_ERROR", payload: "Failed to edit data extraction question" });
    } finally {
      dispatch({ type: "SET_SAVING", payload: false });
    }
  }, [state.review]);

  const goToNextStep = useCallback(async () => {
    if (!state.review || !state.currentStep) return;

    const nextStep = getNextStep(state.currentStep);
    if (nextStep) {
      await updateReviewStep(state.review.id, nextStep);
      dispatch({ type: "SET_STEP", payload: nextStep });

      // Scroll to top smoothly when step changes
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    }
  }, [state.review, state.currentStep]);

  const goToPreviousStep = useCallback(async () => {
    if (!state.review || !state.currentStep) return;

    const prevStep = getPreviousStep(state.currentStep);
    if (prevStep) {
      await updateReviewStep(state.review.id, prevStep);
      dispatch({ type: "SET_STEP", payload: prevStep });

      // Scroll to top smoothly when step changes
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    }
  }, [state.review, state.currentStep]);

  const clearErrors = useCallback(() => {
    dispatch({ type: "CLEAR_ERRORS" });
  }, []);

  const retryLastOperation = useCallback(async () => {
    // This will retry the last failed operation
    // Implementation depends on what operation failed
    console.log("Retrying last operation...");
  }, []);

  const contextValue: ReviewContextValue = {
    ...state,
    loadReview,
    saveResearchQuestion: handleSaveResearchQuestion,
    generateAndSaveSearchTerms,
    generateAndSaveScreeningQuestions,
    generateAndSaveDataExtractionQuestions,
    addCustomScreeningQuestion,
    removeScreeningQuestion,
    editScreeningQuestion,
    addCustomDataExtractionQuestion,
    removeDataExtractionQuestion,
    editDataExtractionQuestion,
    goToNextStep,
    goToPreviousStep,
    clearErrors,
    retryLastOperation,
  };

  return (
    <ReviewContext.Provider value={contextValue}>
      {children}
    </ReviewContext.Provider>
  );
}

export function useReview(): ReviewContextValue {
  const context = useContext(ReviewContext);
  if (!context) {
    throw new Error("useReview must be used within a ReviewProvider");
  }
  return context;
}
