import {
  boolean,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  jsonb,
  varchar,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/*
  Clerk users
  - We keep a minimal users table keyed by Clerk user id (text).
  - You can upsert here on first login or keep it as a purely FK target.
*/
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(), // Clerk user id (e.g., user_123)
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
    credits: integer("credits").notNull().default(0),
  },
  (t) => [index("users_created_at_idx").on(t.createdAt)]
);

/*
  Enums
*/
export const screeningQuestionTypeEnum = pgEnum("screening_question_type", [
  "boolean",
  "number",
  "array",
  "string",
]);

export const screeningStatusEnum = pgEnum("screening_status", [
  "pending",
  "in_progress",
  "completed",
  "error",
]);

export const pdfStatusEnum = pgEnum("pdf_status", [
  "used",
  "metadata",
  "error",
]);

export const aiProviderEnum = pgEnum("ai_provider", ["openai", "google"]);

export const filterTypeEnum = pgEnum("filter_type", ["date", "year"]);

/*
  Ratings
  - Per-user rating for a given paper id.
*/
export const ratings = pgTable(
  "ratings",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    paperId: text("paper_id").notNull(),
    rating: integer("rating").notNull(), // 1..5 or your range
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.paperId] }),
    index("ratings_user_idx").on(t.userId),
    index("ratings_updated_at_idx").on(t.updatedAt),
  ]
);

/*
  Search history (SearchResult)
  - searches: single search "row"
  - search_query_history: appended queries over time
  - search_question_history: appended questions over time
  - search_screening_questions: store configured screening questions for this search
  - search_screening_responses: store per-paper responses for a search
*/
export const searches = pgTable(
  "searches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    query: text("query").notNull(),
    count: integer("count").notNull().default(0),
    field: varchar("field", { length: 64 }).notNull(), // SearchField as text

    // filters & settings
    dateRange: jsonb("date_range"), // { from: string|null, to: string|null }
    yearRange: jsonb("year_range"), // [number, number]
    filterType: filterTypeEnum("filter_type"),
    isYearRangeEnabled: boolean("is_year_range_enabled")
      .notNull()
      .default(false),
    sortBy: varchar("sort_by", { length: 64 }),
    selectedRegions: jsonb("selected_regions"), // string[]
    selectedCountryFocus: jsonb("selected_country_focus"), // string[]
    ratingRange: jsonb("rating_range"), // [number, number]
    onlyRatedPapers: boolean("only_rated_papers").notNull().default(false),

    citesItemId: text("cites_item_id"),
    citedByItemId: text("cited_by_item_id"),
    relatedToItemId: text("related_to_item_id"),
    reviewFilter: boolean("review_filter"), // nullable boolean
    language: varchar("language", { length: 8 }), // ISO 639-1 or extended

    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index("searches_user_idx").on(t.userId),
    index("searches_created_at_idx").on(t.createdAt),
    index("searches_updated_at_idx").on(t.updatedAt),
  ]
);

export const searchQueryHistory = pgTable(
  "search_query_history",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    searchId: uuid("search_id")
      .notNull()
      .references(() => searches.id, { onDelete: "cascade" }),
    query: text("query").notNull(),
    timestamp: timestamp("timestamp", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("search_query_history_search_idx").on(t.searchId)]
);

export const searchQuestionHistory = pgTable(
  "search_question_history",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    searchId: uuid("search_id")
      .notNull()
      .references(() => searches.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    timestamp: timestamp("timestamp", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("search_question_history_search_idx").on(t.searchId)]
);

export const searchScreeningQuestions = pgTable(
  "search_screening_questions",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    searchId: uuid("search_id")
      .notNull()
      .references(() => searches.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    locked: boolean("locked").notNull().default(false),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("search_scr_q_search_idx").on(t.searchId),
    index("search_scr_q_locked_idx").on(t.locked),
  ]
);

export const searchScreeningResponses = pgTable(
  "search_screening_responses",
  {
    searchId: uuid("search_id")
      .notNull()
      .references(() => searches.id, { onDelete: "cascade" }),
    paperId: text("paper_id").notNull(),
    question: text("question").notNull(),
    response: boolean("response"), // nullable -> null means unset
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.searchId, t.paperId, t.question] }),
    index("search_scr_resp_search_idx").on(t.searchId),
    index("search_scr_resp_paper_idx").on(t.paperId),
  ]
);

/*
  Focus mode settings (persisted)
*/
export const focusModeSettings = pgTable(
  "focus_mode_settings",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" })
      .primaryKey(),
    fontSize: varchar("font_size", { length: 8 }).notNull().default("base"), // 'sm' | 'base' | 'lg' | 'xl'
    maxContentWidth: varchar("max_content_width", { length: 8 })
      .notNull()
      .default("medium"), // 'narrow' | 'medium' | 'wide' | 'full'
    lineHeight: varchar("line_height", { length: 8 })
      .notNull()
      .default("normal"), // 'tight' | 'normal' | 'relaxed'
    showMetadata: boolean("show_metadata").notNull().default(true),
    compactMode: boolean("compact_mode").notNull().default(false),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("focus_mode_settings_updated_idx").on(t.updatedAt)]
);

/*
  Keyword expansion (persisted)
*/
export const keywords = pgTable(
  "keywords",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    shorthand: varchar("shorthand", { length: 128 }).notNull(),
    expansion: text("expansion").notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.shorthand] }),
    index("keywords_user_idx").on(t.userId),
  ]
);

/*
  AI Config (persisted)
  - Store provider and budget usage.
  - Store API key encrypted server-side; we only keep ciphertext here.
*/
export const aiConfigs = pgTable(
  "ai_configs",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" })
      .primaryKey(),
    provider: aiProviderEnum("provider").notNull().default("openai"),
    apiKeyCiphertext: text("api_key_ciphertext"), // store encrypted value
    dollarsUsed: numeric("dollars_used", { precision: 12, scale: 4 })
      .notNull()
      .default("0"),
    budget: numeric("budget", { precision: 12, scale: 2 })
      .notNull()
      .default("0"), // 0 == unlimited
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("ai_configs_updated_idx").on(t.updatedAt)]
);

/*
  Screening store (persisted)
  - documents: all saved documents for screening
  - user_screening_questions: user's reusable question library
  - screening_results: answers and AI metadata per document
  - screening_state: small persisted state for UX continuity
*/
export const screeningDocuments = pgTable(
  "screening_documents",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    id: text("id").notNull(), // OpenAlex id or custom id
    title: text("title").notNull(),
    publicationYear: integer("publication_year"),
    abstract: text("abstract"),
    doi: text("doi"),
    authorships: jsonb("authorships"), // raw authors array
    openAccess: jsonb("open_access"), // { is_oa: boolean, oa_url?: string }
    primaryLocation: jsonb("primary_location"),
    citedByCount: integer("cited_by_count"),
    referencedWorksCount: integer("referenced_works_count"),
    addedAt: timestamp("added_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    }).notNull(),
    originalWork: jsonb("original_work"),
    source: varchar("source", { length: 64 }), // e.g., 'zotero'
    zoteroGroupId: text("zotero_group_id"),
    zoteroUri: text("zotero_uri"),

    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    index("screening_docs_user_idx").on(t.userId),
    index("screening_docs_updated_idx").on(t.updatedAt),
  ]
);

export const userScreeningQuestions = pgTable(
  "user_screening_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 128 }).notNull(),
    type: screeningQuestionTypeEnum("type").notNull(),
    question: text("question").notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("user_screening_questions_user_idx").on(t.userId),
    index("user_screening_questions_key_idx").on(t.key),
  ]
);

export const screeningResults = pgTable(
  "screening_results",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    documentId: text("document_id").notNull(),
    answers: jsonb("answers")
      .notNull()
      .default(sql`'{}'::jsonb`), // key->value
    status: screeningStatusEnum("status").notNull().default("pending"),
    completedAt: timestamp("completed_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    }),
    pdfStatus: pdfStatusEnum("pdf_status"),
    pdfErrorMessage: text("pdf_error_message"),
    aiMetadata: jsonb("ai_metadata"), // reasoning, confidence, flags, provider, model, processedAt
    cost: numeric("cost", { precision: 12, scale: 4 }), // USD

    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.documentId] }),
    index("screening_results_status_idx").on(t.status),
    index("screening_results_updated_idx").on(t.updatedAt),
  ]
);

export const screeningState = pgTable(
  "screening_state",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" })
      .primaryKey(),
    isScreeningStarted: boolean("is_screening_started")
      .notNull()
      .default(false),
    currentDocumentIndex: integer("current_document_index")
      .notNull()
      .default(0),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("screening_state_updated_idx").on(t.updatedAt)]
);

/*
  Zotero config (persisted)
*/
export const zoteroConfigs = pgTable(
  "zotero_configs",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" })
      .primaryKey(),
    zoteroApiKeyCiphertext: text("zotero_api_key_ciphertext"),
    zoteroGroupId: text("zotero_group_id"),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("zotero_configs_updated_idx").on(t.updatedAt)]
);

/*
  Review store (persisted)
*/
export const reviewState = pgTable(
  "review_state",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" })
      .primaryKey(),
    step: integer("step").notNull().default(1),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("review_state_updated_idx").on(t.updatedAt)]
);

/*
  Transient screening store (persisted subset only)
  - Only testIndexPerQuestion persists per your partialize config.
*/
export const transientScreening = pgTable(
  "transient_screening",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(), // question key
    indexValue: integer("index_value").notNull().default(0),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key] }),
    index("transient_screening_user_idx").on(t.userId),
  ]
);
