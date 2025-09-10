import {
  pgTable,
  serial,
  text,
  jsonb,
  integer,
  timestamp,
  varchar,
  boolean,
  uuid,
  pgEnum,
  index
} from "drizzle-orm/pg-core";
import { SearchTermData, ScreeningQuestion, DataExtractionQuestion } from "@/lib/repo";

// Enums for status and steps
export const reviewStatusEnum = pgEnum('review_status', [
  'draft',
  'in_progress',
  'completed',
  'paused',
  'cancelled'
]);

export const stepEnum = pgEnum('step', [
  'research_question',
  'search_terms',
  'screening_questions',
  'data_extraction_questions',
  'search_execution',
  'screening',
  'data_extraction',
  'completed'
]);

// Main systematic review table
export const systematicReviews = pgTable('systematic_reviews', {
  // Primary identifiers
  id: serial('id').primaryKey(),
  uuid: uuid('uuid').defaultRandom().unique(),

  // Basic metadata
  title: varchar('title', { length: 500 }),
  description: text('description'),

  // Status and progress
  status: reviewStatusEnum('status').default('draft'),
  currentStep: stepEnum('current_step').default('research_question'),
  progress: integer('progress').default(0), // Percentage 0-100

  // Core research data
  researchQuestion: text('research_question'),
  searchTerms: jsonb('search_terms').$type<SearchTermData[]>(), // Array of boolean search terms with enabled state (backward compatible)
  screeningQuestions: jsonb('screening_questions').$type<string[]>(), // Array of screening questions
  dataExtractionQuestions: jsonb('data_extraction_questions').$type<ScreeningQuestion[]>(), // Array of complex data extraction questions

  // Results data
  searchResults: jsonb('search_results').$type<any[]>(), // Array of search result objects
  searchResultsCount: integer('search_results_count').default(0),

  screeningResults: jsonb('screening_results').$type<any[]>(), // Array of screening result objects
  screeningResultsCount: integer('screening_results_count').default(0),

  dataExtractionResults: jsonb('data_extraction_results').$type<any[]>(), // Array of extraction result objects
  dataExtractionResultsCount: integer('data_extraction_results_count').default(0),

  // Step completion timestamps
  researchQuestionCompletedAt: timestamp('research_question_completed_at'),
  searchTermsCompletedAt: timestamp('search_terms_completed_at'),
  screeningQuestionsCompletedAt: timestamp('screening_questions_completed_at'),
  dataExtractionQuestionsCompletedAt: timestamp('data_extraction_questions_completed_at'),
  searchExecutionCompletedAt: timestamp('search_execution_completed_at'),
  screeningCompletedAt: timestamp('screening_completed_at'),
  dataExtractionCompletedAt: timestamp('data_extraction_completed_at'),

  // Additional metadata
  userId: varchar('user_id', { length: 255 }), // For multi-user support
  projectSettings: jsonb('project_settings').$type<{
    database?: string;
    dateRange?: { start?: string; end?: string };
    inclusionCriteria?: string[];
    exclusionCriteria?: string[];
    exportFormats?: string[];
  }>(),

  // Audit fields
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  lastAccessedAt: timestamp('last_accessed_at'),

  // Notes and error tracking
  notes: text('notes'),
  errorLogs: jsonb('error_logs').$type<Array<{
    timestamp: string;
    step: string;
    error: string;
    details?: any;
  }>>(),

  // Performance metrics
  totalSearchTime: integer('total_search_time'), // in seconds
  totalScreeningTime: integer('total_screening_time'), // in seconds
  totalExtractionTime: integer('total_extraction_time'), // in seconds

  // Version control
  version: integer('version').default(1),
  parentReviewId: integer('parent_review_id') // For forked reviews - self reference will be handled in relations
}, (table) => [
  // Indexes for better query performance
  index('systematic_reviews_status_idx').on(table.status),
  index('systematic_reviews_user_idx').on(table.userId),
  index('systematic_reviews_created_at_idx').on(table.createdAt),
  index('systematic_reviews_updated_at_idx').on(table.updatedAt),
]);

// Export types for use in application code
export type SystematicReview = typeof systematicReviews.$inferSelect;
export type NewSystematicReview = typeof systematicReviews.$inferInsert;
export type ReviewStatus = typeof reviewStatusEnum.enumValues[number];
export type Step = typeof stepEnum.enumValues[number];
