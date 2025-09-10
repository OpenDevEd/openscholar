"use server";

import { db } from '@/db';
import { systematicReviews, NewSystematicReview, SystematicReview, ReviewStatus, Step } from '@/db/schema';
import {
  SearchTermData,
  ScreeningQuestion,
  generateMockSearchTerms,
  generateMockScreeningQuestions,
  generateMockDataExtractionQuestions,
  createSearchTerm
} from '@/lib/repo';
import { eq, desc, and, sql } from 'drizzle-orm';

// ============================================================================
// GENERAL REVIEW OPERATIONS
// ============================================================================

/**
 * Create a new systematic review
 */
export async function createReview(data: Omit<NewSystematicReview, 'id' | 'createdAt' | 'updatedAt'>): Promise<SystematicReview> {
  try {
    const [review] = await db.insert(systematicReviews).values(data).returning();
    return review;
  } catch (error) {
    console.error('Failed to create review:', error);
    throw new Error('Failed to create systematic review');
  }
}

/**
 * Get a review by ID
 */
export async function getReview(id: number): Promise<SystematicReview | null> {
  try {
    const [review] = await db.select().from(systematicReviews).where(eq(systematicReviews.id, id));
    return review || null;
  } catch (error) {
    console.error('Failed to get review:', error);
    throw new Error('Failed to retrieve systematic review');
  }
}

/**
 * Get a review by UUID
 */
export async function getReviewByUuid(uuid: string): Promise<SystematicReview | null> {
  try {
    const [review] = await db.select().from(systematicReviews).where(eq(systematicReviews.uuid, uuid));
    return review || null;
  } catch (error) {
    console.error('Failed to get review by UUID:', error);
    throw new Error('Failed to retrieve systematic review');
  }
}

/**
 * Get all reviews for a user
 */
export async function getUserReviews(userId?: string): Promise<SystematicReview[]> {
  try {
    const query = db.select().from(systematicReviews);

    if (userId) {
      query.where(eq(systematicReviews.userId, userId));
    }

    const reviews = await query.orderBy(desc(systematicReviews.updatedAt));
    return reviews;
  } catch (error) {
    console.error('Failed to get user reviews:', error);
    throw new Error('Failed to retrieve user reviews');
  }
}

/**
 * Update a review
 */
export async function updateReview(id: number, data: Partial<Omit<NewSystematicReview, 'id' | 'createdAt'>>): Promise<SystematicReview> {
  try {
    const [review] = await db
      .update(systematicReviews)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(systematicReviews.id, id))
      .returning();

    if (!review) {
      throw new Error('Review not found');
    }

    return review;
  } catch (error) {
    console.error('Failed to update review:', error);
    throw new Error('Failed to update systematic review');
  }
}

/**
 * Delete a review
 */
export async function deleteReview(id: number): Promise<void> {
  try {
    await db.delete(systematicReviews).where(eq(systematicReviews.id, id));
  } catch (error) {
    console.error('Failed to delete review:', error);
    throw new Error('Failed to delete systematic review');
  }
}

// ============================================================================
// STEP 1: RESEARCH QUESTION OPERATIONS
// ============================================================================

/**
 * Save or update research question for a review
 */
export async function saveResearchQuestion(reviewId: number, researchQuestion: string): Promise<SystematicReview> {
  try {
    const [review] = await db
      .update(systematicReviews)
      .set({
        researchQuestion,
        researchQuestionCompletedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(systematicReviews.id, reviewId))
      .returning();

    if (!review) {
      throw new Error('Review not found');
    }

    return review;
  } catch (error) {
    console.error('Failed to save research question:', error);
    throw new Error('Failed to save research question');
  }
}

// ============================================================================
// STEP 2: BOOLEAN SEARCH TERMS OPERATIONS
// ============================================================================

/**
 * Generate boolean search terms based on research question
 */
export async function generateBooleanSearchTerms(reviewId: number): Promise<SearchTermData[]> {
  try {
    // Get the review to access the research question
    const review = await getReview(reviewId);
    if (!review || !review.researchQuestion) {
      throw new Error('Research question not found');
    }

    // TODO: Replace with actual AI API call
    // For now, return mock data based on research question
    return generateMockSearchTerms();
  } catch (error) {
    console.error('Failed to generate boolean search terms:', error);
    throw new Error('Failed to generate boolean search terms');
  }
}

/**
 * Save boolean search terms for a review
 */
export async function saveBooleanSearchTerms(reviewId: number, searchTerms: SearchTermData[]): Promise<SystematicReview> {
  try {
    const [review] = await db
      .update(systematicReviews)
      .set({
        searchTerms,
        searchTermsCompletedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(systematicReviews.id, reviewId))
      .returning();

    if (!review) {
      throw new Error('Review not found');
    }

    return review;
  } catch (error) {
    console.error('Failed to save boolean search terms:', error);
    throw new Error('Failed to save boolean search terms');
  }
}

// ============================================================================
// STEP 3: SCREENING QUESTIONS OPERATIONS
// ============================================================================

/**
 * Generate screening questions based on research question
 */
export async function generateScreeningQuestions(reviewId: number): Promise<string[]> {
  try {
    // Get the review to access the research question
    const review = await getReview(reviewId);
    if (!review || !review.researchQuestion) {
      throw new Error('Research question not found');
    }

    // TODO: Replace with actual AI API call
    // For now, return mock screening questions
    return generateMockScreeningQuestions();
  } catch (error) {
    console.error('Failed to generate screening questions:', error);
    throw new Error('Failed to generate screening questions');
  }
}

/**
 * Save screening questions for a review
 */
export async function saveScreeningQuestions(reviewId: number, screeningQuestions: string[]): Promise<SystematicReview> {
  try {
    const [review] = await db
      .update(systematicReviews)
      .set({
        screeningQuestions,
        screeningQuestionsCompletedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(systematicReviews.id, reviewId))
      .returning();

    if (!review) {
      throw new Error('Review not found');
    }

    return review;
  } catch (error) {
    console.error('Failed to save screening questions:', error);
    throw new Error('Failed to save screening questions');
  }
}

/**
 * Add a custom screening question to a review
 */
export async function addCustomScreeningQuestion(reviewId: number, question: string): Promise<SystematicReview> {
  try {
    const review = await getReview(reviewId);
    if (!review) {
      throw new Error('Review not found');
    }

    const currentQuestions = review.screeningQuestions || [];
    const updatedQuestions = [...currentQuestions, question.trim()];

    return await saveScreeningQuestions(reviewId, updatedQuestions);
  } catch (error) {
    console.error('Failed to add custom screening question:', error);
    throw new Error('Failed to add custom screening question');
  }
}

/**
 * Edit a screening question in a review
 */
export async function editScreeningQuestion(reviewId: number, questionIndex: number, newQuestion: string): Promise<SystematicReview> {
  try {
    const review = await getReview(reviewId);
    if (!review || !review.screeningQuestions) {
      throw new Error('Review or screening questions not found');
    }

    if (questionIndex < 0 || questionIndex >= review.screeningQuestions.length) {
      throw new Error('Invalid question index');
    }

    const updatedQuestions = [...review.screeningQuestions];
    updatedQuestions[questionIndex] = newQuestion.trim();

    const [updatedReview] = await db
      .update(systematicReviews)
      .set({
        screeningQuestions: updatedQuestions,
        updatedAt: new Date()
      })
      .where(eq(systematicReviews.id, reviewId))
      .returning();

    if (!updatedReview) {
      throw new Error('Review not found');
    }

    return updatedReview;
  } catch (error) {
    console.error('Failed to edit screening question:', error);
    throw new Error('Failed to edit screening question');
  }
}

/**
 * Remove a screening question from a review
 */
export async function removeScreeningQuestion(reviewId: number, questionIndex: number): Promise<SystematicReview> {
  try {
    const review = await getReview(reviewId);
    if (!review || !review.screeningQuestions) {
      throw new Error('Review or screening questions not found');
    }

    const updatedQuestions = review.screeningQuestions.filter((_, index) => index !== questionIndex);

    const [updatedReview] = await db
      .update(systematicReviews)
      .set({
        screeningQuestions: updatedQuestions,
        updatedAt: new Date()
      })
      .where(eq(systematicReviews.id, reviewId))
      .returning();

    if (!updatedReview) {
      throw new Error('Review not found');
    }

    return updatedReview;
  } catch (error) {
    console.error('Failed to remove screening question:', error);
    throw new Error('Failed to remove screening question');
  }
}

// ============================================================================
// STEP 4: DATA EXTRACTION QUESTIONS OPERATIONS
// ============================================================================

/**
 * Generate data extraction questions based on research question
 */
export async function generateDataExtractionQuestions(reviewId: number): Promise<ScreeningQuestion[]> {
  try {
    // Get the review to access the research question
    const review = await getReview(reviewId);
    if (!review || !review.researchQuestion) {
      throw new Error('Research question not found');
    }

    // TODO: Replace with actual AI API call
    // For now, return mock data extraction questions
    return generateMockDataExtractionQuestions();
  } catch (error) {
    console.error('Failed to generate data extraction questions:', error);
    throw new Error('Failed to generate data extraction questions');
  }
}

/**
 * Save data extraction questions for a review
 */
export async function saveDataExtractionQuestions(reviewId: number, dataExtractionQuestions: any[]): Promise<SystematicReview> {
  try {
    const [review] = await db
      .update(systematicReviews)
      .set({
        dataExtractionQuestions,
        dataExtractionQuestionsCompletedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(systematicReviews.id, reviewId))
      .returning();

    if (!review) {
      throw new Error('Review not found');
    }

    return review;
  } catch (error) {
    console.error('Failed to save data extraction questions:', error);
    throw new Error('Failed to save data extraction questions');
  }
}

/**
 * Add a custom data extraction question to a review
 */
export async function addCustomDataExtractionQuestion(
  reviewId: number,
  question: string,
  type: 'boolean' | 'string' | 'number' | 'array'
): Promise<SystematicReview> {
  try {
    const review = await getReview(reviewId);
    if (!review) {
      throw new Error('Review not found');
    }

    const currentQuestions = review.dataExtractionQuestions || [];
    const newQuestion = {
      id: `q_${Date.now()}_custom`,
      key: question.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_'),
      type,
      question: question.trim()
    };

    const updatedQuestions = [...currentQuestions, newQuestion];

    return await saveDataExtractionQuestions(reviewId, updatedQuestions);
  } catch (error) {
    console.error('Failed to add custom data extraction question:', error);
    throw new Error('Failed to add custom data extraction question');
  }
}

/**
 * Edit a data extraction question in a review
 */
export async function editDataExtractionQuestion(
  reviewId: number,
  questionIndex: number,
  newQuestion: string,
  newType?: 'boolean' | 'string' | 'number' | 'array'
): Promise<SystematicReview> {
  try {
    const review = await getReview(reviewId);
    if (!review || !review.dataExtractionQuestions) {
      throw new Error('Review or data extraction questions not found');
    }

    if (questionIndex < 0 || questionIndex >= review.dataExtractionQuestions.length) {
      throw new Error('Invalid question index');
    }

    const updatedQuestions = [...review.dataExtractionQuestions];
    const originalQuestion = updatedQuestions[questionIndex];

    // Update the question text and optionally the type
    updatedQuestions[questionIndex] = {
      ...originalQuestion,
      question: newQuestion.trim(),
      ...(newType && { type: newType }),
      // Update the key if the question text changed significantly
      key: newQuestion.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_')
    };

    const [updatedReview] = await db
      .update(systematicReviews)
      .set({
        dataExtractionQuestions: updatedQuestions,
        updatedAt: new Date()
      })
      .where(eq(systematicReviews.id, reviewId))
      .returning();

    if (!updatedReview) {
      throw new Error('Review not found');
    }

    return updatedReview;
  } catch (error) {
    console.error('Failed to edit data extraction question:', error);
    throw new Error('Failed to edit data extraction question');
  }
}

/**
 * Remove a data extraction question from a review
 */
export async function removeDataExtractionQuestion(reviewId: number, questionIndex: number): Promise<SystematicReview> {
  try {
    const review = await getReview(reviewId);
    if (!review || !review.dataExtractionQuestions) {
      throw new Error('Review or data extraction questions not found');
    }

    const updatedQuestions = review.dataExtractionQuestions.filter((_, index) => index !== questionIndex);

    const [updatedReview] = await db
      .update(systematicReviews)
      .set({
        dataExtractionQuestions: updatedQuestions,
        updatedAt: new Date()
      })
      .where(eq(systematicReviews.id, reviewId))
      .returning();

    if (!updatedReview) {
      throw new Error('Review not found');
    }

    return updatedReview;
  } catch (error) {
    console.error('Failed to remove data extraction question:', error);
    throw new Error('Failed to remove data extraction question');
  }
}

// ============================================================================
// SEARCH EXECUTION OPERATIONS
// ============================================================================

/**
 * Save search results for a review
 */
export async function saveSearchResults(
  reviewId: number,
  searchResults: any[],
  searchResultsCount: number
): Promise<SystematicReview> {
  try {
    const [review] = await db
      .update(systematicReviews)
      .set({
        searchResults,
        searchResultsCount,
        currentStep: 'screening',
        searchExecutionCompletedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(systematicReviews.id, reviewId))
      .returning();

    if (!review) {
      throw new Error('Review not found');
    }

    return review;
  } catch (error) {
    console.error('Failed to save search results:', error);
    throw new Error('Failed to save search results');
  }
}

// ============================================================================
// SCREENING OPERATIONS
// ============================================================================

/**
 * Save screening results for a review
 */
export async function saveScreeningResults(
  reviewId: number,
  screeningResults: any[],
  screeningResultsCount: number
): Promise<SystematicReview> {
  try {
    const [review] = await db
      .update(systematicReviews)
      .set({
        screeningResults,
        screeningResultsCount,
        currentStep: 'data_extraction',
        screeningCompletedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(systematicReviews.id, reviewId))
      .returning();

    if (!review) {
      throw new Error('Review not found');
    }

    return review;
  } catch (error) {
    console.error('Failed to save screening results:', error);
    throw new Error('Failed to save screening results');
  }
}

// ============================================================================
// DATA EXTRACTION OPERATIONS
// ============================================================================

/**
 * Save data extraction results for a review
 */
export async function saveDataExtractionResults(
  reviewId: number,
  dataExtractionResults: any[],
  dataExtractionResultsCount: number
): Promise<SystematicReview> {
  try {
    const [review] = await db
      .update(systematicReviews)
      .set({
        dataExtractionResults,
        dataExtractionResultsCount,
        currentStep: 'completed',
        dataExtractionCompletedAt: new Date(),
        status: 'completed',
        progress: 100,
        updatedAt: new Date()
      })
      .where(eq(systematicReviews.id, reviewId))
      .returning();

    if (!review) {
      throw new Error('Review not found');
    }

    return review;
  } catch (error) {
    console.error('Failed to save data extraction results:', error);
    throw new Error('Failed to save data extraction results');
  }
}

// ============================================================================
// UTILITY OPERATIONS
// ============================================================================

/**
 * Update review progress
 */
export async function updateReviewProgress(reviewId: number, progress: number): Promise<SystematicReview> {
  try {
    const [review] = await db
      .update(systematicReviews)
      .set({
        progress,
        updatedAt: new Date()
      })
      .where(eq(systematicReviews.id, reviewId))
      .returning();

    if (!review) {
      throw new Error('Review not found');
    }

    return review;
  } catch (error) {
    console.error('Failed to update review progress:', error);
    throw new Error('Failed to update review progress');
  }
}

/**
 * Update review status
 */
export async function updateReviewStatus(reviewId: number, status: ReviewStatus): Promise<SystematicReview> {
  try {
    const [review] = await db
      .update(systematicReviews)
      .set({
        status,
        updatedAt: new Date()
      })
      .where(eq(systematicReviews.id, reviewId))
      .returning();

    if (!review) {
      throw new Error('Review not found');
    }

    return review;
  } catch (error) {
    console.error('Failed to update review status:', error);
    throw new Error('Failed to update review status');
  }
}

/**
 * Update current step
 */
export async function updateReviewStep(reviewId: number, step: Step): Promise<SystematicReview> {
  try {
    const [review] = await db
      .update(systematicReviews)
      .set({
        currentStep: step,
        updatedAt: new Date()
      })
      .where(eq(systematicReviews.id, reviewId))
      .returning();

    if (!review) {
      throw new Error('Review not found');
    }

    return review;
  } catch (error) {
    console.error('Failed to update review step:', error);
    throw new Error('Failed to update review step');
  }
}

/**
 * Add an error log to a review
 */
export async function addReviewError(reviewId: number, step: string, error: string, details?: any): Promise<void> {
  try {
    const review = await getReview(reviewId);
    if (!review) {
      throw new Error('Review not found');
    }

    const currentErrors = review.errorLogs || [];
    const newError = {
      timestamp: new Date().toISOString(),
      step,
      error,
      details
    };

    const updatedErrors = [...currentErrors, newError];

    await db
      .update(systematicReviews)
      .set({
        errorLogs: updatedErrors,
        updatedAt: new Date()
      })
      .where(eq(systematicReviews.id, reviewId));
  } catch (error) {
    console.error('Failed to add review error:', error);
    throw new Error('Failed to add review error');
  }
}

/**
 * Update review notes
 */
export async function updateReviewNotes(reviewId: number, notes: string): Promise<SystematicReview> {
  try {
    const [review] = await db
      .update(systematicReviews)
      .set({
        notes,
        updatedAt: new Date()
      })
      .where(eq(systematicReviews.id, reviewId))
      .returning();

    if (!review) {
      throw new Error('Review not found');
    }

    return review;
  } catch (error) {
    console.error('Failed to update review notes:', error);
    throw new Error('Failed to update review notes');
  }
}

// ============================================================================
// LIST VIEW OPERATIONS (EXCLUDE JSON FIELDS)
// ============================================================================

/**
 * Type for review list items (excluding JSON fields)
 */
export type ReviewListItem = {
  id: number;
  uuid: string | null;
  title: string | null;
  description: string | null;
  status: string | null;
  currentStep: string | null;
  progress: number | null;
  searchResultsCount: number | null;
  screeningResultsCount: number | null;
  dataExtractionResultsCount: number | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  lastAccessedAt: Date | null;
  userId: string | null;
};

/**
 * Get all reviews for listing (excluding JSON fields for performance)
 */
export async function getReviewsForList(userId?: string): Promise<ReviewListItem[]> {
  try {
    const query = db
      .select({
        id: systematicReviews.id,
        uuid: systematicReviews.uuid,
        title: systematicReviews.title,
        description: systematicReviews.description,
        status: systematicReviews.status,
        currentStep: systematicReviews.currentStep,
        progress: systematicReviews.progress,
        searchResultsCount: systematicReviews.searchResultsCount,
        screeningResultsCount: systematicReviews.screeningResultsCount,
        dataExtractionResultsCount: systematicReviews.dataExtractionResultsCount,
        createdAt: systematicReviews.createdAt,
        updatedAt: systematicReviews.updatedAt,
        lastAccessedAt: systematicReviews.lastAccessedAt,
        userId: systematicReviews.userId,
      })
      .from(systematicReviews);

    if (userId) {
      query.where(eq(systematicReviews.userId, userId));
    }

    const reviews = await query.orderBy(desc(systematicReviews.updatedAt));
    return reviews;
  } catch (error) {
    console.error('Failed to get reviews for list:', error);
    throw new Error('Failed to retrieve reviews');
  }
}

/**
 * Create a new review (minimal version for quick creation)
 */
export async function createReviewQuick(data: {
  title?: string;
  description?: string;
  userId?: string;
}): Promise<{ id: number; uuid: string | null }> {
  try {
    const [review] = await db
      .insert(systematicReviews)
      .values({
        title: data.title || null,
        description: data.description || null,
        userId: data.userId || null,
      })
      .returning({ id: systematicReviews.id, uuid: systematicReviews.uuid });

    return review;
  } catch (error) {
    console.error('Failed to create quick review:', error);
    throw new Error('Failed to create systematic review');
  }
}
