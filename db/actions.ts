'use server';

import { auth } from '@clerk/nextjs/server';
import { randomUUID } from 'crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db'; // your initialized drizzle instance
import * as s from '@/db/schema'; // drizzle schema (with composite FK fix for screening_results)

/*
  NOTE ABOUT YOUR ERROR:
  You saw "violates foreign key constraint ... users".
  This file ensures a user row exists before any user-scoped insert/update
  via ensureUserRow(), called inside requireUser().

  Also fixes onConflictDoUpdate syntax issues and keeps only the endpoints
  you hydrate: ratings, searches, focus settings, keywords, AI config,
  and user screening questions (library). Others are omitted.
*/

/* Helpers */

async function ensureUserRow(userId: string) {
  await db
    .insert(s.users)
    .values({ id: userId })
    .onConflictDoNothing();
}

async function requireUser() {
  const { userId } = await auth();
  if (!userId) throw new Error('Unauthorized');
  await ensureUserRow(userId);
  return userId;
}

export async function getUser() {
  const { userId } = await auth();
  if (!userId) throw new Error('Unauthorized');
  const row = await db.select().from(s.users).where(eq(s.users.id, userId));
  if (!row || row.length === 0) throw new Error('User not found');
  return row[0];
}

function now() {
  return new Date();
}

/* TYPES returned to the client for hydrating Zustand */

export type RatingRow = {
  paperId: string;
  rating: number;
  updatedAt: string;
  createdAt: string;
};

export type SearchResultDTO = {
  id: string;
  query: string;
  queryHistory: { query: string; timestamp: string }[];
  questionHistory: { question: string; timestamp: string }[];
  screeningQuestions: { id: number; question: string; locked: boolean }[];
  screeningResponses: Record<string, Record<string, boolean | null>>;
  count: number;
  field: string;
  dateRange?: { from?: string | null; to?: string | null } | null;
  yearRange?: [number, number] | null;
  filterType?: 'date' | 'year' | null;
  isYearRangeEnabled?: boolean;
  sortBy?: string | null;
  selectedRegions?: string[] | null;
  selectedCountryFocus?: string[] | null;
  ratingRange?: [number, number] | null;
  onlyRatedPapers?: boolean;
  citesItemId?: string | null;
  citedByItemId?: string | null;
  relatedToItemId?: string | null;
  reviewFilter?: boolean | null;
  language?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FocusModeSettingsDTO = {
  fontSize: 'sm' | 'base' | 'lg' | 'xl';
  maxContentWidth: 'narrow' | 'medium' | 'wide' | 'full';
  lineHeight: 'tight' | 'normal' | 'relaxed';
  showMetadata: boolean;
  compactMode: boolean;
  updatedAt: string;
  createdAt: string;
};

export type KeywordDTO = {
  shorthand: string;
  expansion: string;
  createdAt: string;
  updatedAt: string;
};

export type AIConfigDTO = {
  provider: 'openai' | 'google';
  dollarsUsed: string; // numeric
  budget: string; // numeric
  hasApiKey: boolean; // do not return secrets
  updatedAt: string;
  createdAt: string;
};

export type UserScreeningQuestionDTO = {
  id: string;
  key: string;
  type: 'boolean' | 'number' | 'array' | 'string';
  question: string;
  createdAt: string;
};

/* RATINGS */

export async function getRatings(): Promise<RatingRow[]> {
  const userId = await requireUser();
  const rows = await db
    .select({
      paperId: s.ratings.paperId,
      rating: s.ratings.rating,
      updatedAt: s.ratings.updatedAt,
      createdAt: s.ratings.createdAt,
    })
    .from(s.ratings)
    .where(eq(s.ratings.userId, userId));
  return rows.map((r) => ({
    ...r,
    updatedAt: r.updatedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function upsertRating(paperId: string, rating: number | null) {
  const userId = await requireUser();
  if (rating === null) {
    await db
      .delete(s.ratings)
      .where(and(eq(s.ratings.userId, userId), eq(s.ratings.paperId, paperId)));
    return;
  }
  await db
    .insert(s.ratings)
    .values({ userId, paperId, rating })
    .onConflictDoUpdate({
      target: [s.ratings.userId, s.ratings.paperId],
      set: { rating, updatedAt: now() },
    });
}

export async function clearRatings() {
  const userId = await requireUser();
  await db.delete(s.ratings).where(eq(s.ratings.userId, userId));
}

/* SEARCHES + HISTORY + SCREENING QUESTIONS/RESPONSES */

export async function createSearch(input: {
  id?: string;
  query: string;
  count: number;
  field: string;
  dateRange?: { from?: string | null; to?: string | null } | null;
  yearRange?: [number, number] | null;
  filterType?: 'date' | 'year' | null;
  isYearRangeEnabled?: boolean;
  sortBy?: string | null;
  selectedRegions?: string[] | null;
  selectedCountryFocus?: string[] | null;
  ratingRange?: [number, number] | null;
  onlyRatedPapers?: boolean;
  citesItemId?: string | null;
  citedByItemId?: string | null;
  relatedToItemId?: string | null;
  reviewFilter?: boolean | null;
  language?: string | null;
}): Promise<string> {
  const userId = await requireUser();
  const id = input.id ?? randomUUID();

  await db.insert(s.searches).values({
    id,
    userId,
    query: input.query,
    count: input.count ?? 0,
    field: input.field,
    dateRange: input.dateRange ?? null,
    yearRange: input.yearRange ?? null,
    filterType: input.filterType ?? null,
    isYearRangeEnabled: input.isYearRangeEnabled ?? false,
    sortBy: input.sortBy ?? null,
    selectedRegions: input.selectedRegions ?? null,
    selectedCountryFocus: input.selectedCountryFocus ?? null,
    ratingRange: input.ratingRange ?? null,
    onlyRatedPapers: input.onlyRatedPapers ?? false,
    citesItemId: input.citesItemId ?? null,
    citedByItemId: input.citedByItemId ?? null,
    relatedToItemId: input.relatedToItemId ?? null,
    reviewFilter: input.reviewFilter ?? null,
    language: input.language ?? null,
  });

  await db.insert(s.searchQueryHistory).values({
    searchId: id,
    query: input.query,
  });

  return id;
}

export async function updateSearch(
  id: string,
  updates: Partial<{
    query: string;
    count: number;
    field: string;
    dateRange: { from?: string | null; to?: string | null } | null;
    yearRange: [number, number] | null;
    filterType: 'date' | 'year' | null;
    isYearRangeEnabled: boolean;
    sortBy: string | null;
    selectedRegions: string[] | null;
    selectedCountryFocus: string[] | null;
    ratingRange: [number, number] | null;
    onlyRatedPapers: boolean;
    citesItemId: string | null;
    citedByItemId: string | null;
    relatedToItemId: string | null;
    reviewFilter: boolean | null;
    language: string | null;
  }>
) {
  const userId = await requireUser();
  await db
    .update(s.searches)
    .set({ ...updates, updatedAt: now() })
    .where(and(eq(s.searches.id, id), eq(s.searches.userId, userId)));
}

export async function deleteSearch(id: string) {
  const userId = await requireUser();
  await db
    .delete(s.searches)
    .where(and(eq(s.searches.id, id), eq(s.searches.userId, userId)));
}

export async function clearSearches() {
  const userId = await requireUser();
  await db.delete(s.searches).where(eq(s.searches.userId, userId));
}

export async function addSearchQuery(searchId: string, query: string) {
  const userId = await requireUser();
  await db.insert(s.searchQueryHistory).values({ searchId, query });
  await db
    .update(s.searches)
    .set({ query, updatedAt: now() })
    .where(and(eq(s.searches.id, searchId), eq(s.searches.userId, userId)));
}

export async function addSearchQuestion(searchId: string, question: string) {
  await requireUser();
  await db.insert(s.searchQuestionHistory).values({ searchId, question });
}

export async function addSearchScreeningQuestion(input: {
  searchId: string;
  question: string;
  locked?: boolean;
}): Promise<{ id: number; question: string; locked: boolean }> {
  await requireUser();
  const [row] = await db
    .insert(s.searchScreeningQuestions)
    .values({
      searchId: input.searchId,
      question: input.question,
      locked: input.locked ?? false,
    })
    .returning();
  return { id: row.id!, question: row.question, locked: row.locked };
}

export async function clearSearchScreeningQuestions(searchId: string) {
  await requireUser();
  await db
    .delete(s.searchScreeningQuestions)
    .where(eq(s.searchScreeningQuestions.searchId, searchId));
}

export async function upsertSearchScreeningResponse(input: {
  searchId: string;
  paperId: string;
  question: string;
  response: boolean | null;
}) {
  await requireUser();
  if (input.response === null) {
    await db
      .delete(s.searchScreeningResponses)
      .where(
        and(
          eq(s.searchScreeningResponses.searchId, input.searchId),
          eq(s.searchScreeningResponses.paperId, input.paperId),
          eq(s.searchScreeningResponses.question, input.question)
        )
      );
    return;
  }
  await db
    .insert(s.searchScreeningResponses)
    .values({
      searchId: input.searchId,
      paperId: input.paperId,
      question: input.question,
      response: input.response,
      updatedAt: now(),
    })
    .onConflictDoUpdate({
      target: [
        s.searchScreeningResponses.searchId,
        s.searchScreeningResponses.paperId,
        s.searchScreeningResponses.question,
      ],
      set: { response: input.response, updatedAt: now() },
    });
}

export async function upsertSearchScreeningResponses(input: {
  searchId: string;
  paperId: string;
  responses: Record<string, boolean | null>;
}) {
  await Promise.all(
    Object.entries(input.responses).map(([question, response]) =>
      upsertSearchScreeningResponse({
        searchId: input.searchId,
        paperId: input.paperId,
        question,
        response,
      })
    )
  );
}

export async function clearSearchScreeningResponses(
  searchId: string,
  paperId?: string
) {
  await requireUser();
  if (paperId) {
    await db
      .delete(s.searchScreeningResponses)
      .where(
        and(
          eq(s.searchScreeningResponses.searchId, searchId),
          eq(s.searchScreeningResponses.paperId, paperId)
        )
      );
  } else {
    await db
      .delete(s.searchScreeningResponses)
      .where(eq(s.searchScreeningResponses.searchId, searchId));
  }
}

export async function removeSearchScreeningQuestionFromAllPapers(
  searchId: string,
  question: string
) {
  await requireUser();
  await db
    .delete(s.searchScreeningResponses)
    .where(
      and(
        eq(s.searchScreeningResponses.searchId, searchId),
        eq(s.searchScreeningResponses.question, question)
      )
    );
}

export async function getSearchById(
  id: string
): Promise<SearchResultDTO | null> {
  const userId = await requireUser();
  const [row] = await db
    .select()
    .from(s.searches)
    .where(and(eq(s.searches.id, id), eq(s.searches.userId, userId)));
  if (!row) return null;

  const [qh, qqh, ssq, ssr] = await Promise.all([
    db
      .select()
      .from(s.searchQueryHistory)
      .where(eq(s.searchQueryHistory.searchId, id))
      .orderBy(s.searchQueryHistory.timestamp),
    db
      .select()
      .from(s.searchQuestionHistory)
      .where(eq(s.searchQuestionHistory.searchId, id))
      .orderBy(s.searchQuestionHistory.timestamp),
    db
      .select()
      .from(s.searchScreeningQuestions)
      .where(eq(s.searchScreeningQuestions.searchId, id))
      .orderBy(s.searchScreeningQuestions.id),
    db
      .select()
      .from(s.searchScreeningResponses)
      .where(eq(s.searchScreeningResponses.searchId, id)),
  ]);

  const screeningResponses: Record<
    string,
    Record<string, boolean | null>
  > = {};
  for (const r of ssr) {
    screeningResponses[r.paperId] ||= {};
    screeningResponses[r.paperId][r.question] = r.response;
  }

  return {
    id: row.id,
    query: row.query,
    queryHistory: qh.map((x) => ({
      query: x.query,
      timestamp: x.timestamp.toISOString(),
    })),
    questionHistory: qqh.map((x) => ({
      question: x.question,
      timestamp: x.timestamp.toISOString(),
    })),
    screeningQuestions: ssq.map((x) => ({
      id: x.id!,
      question: x.question,
      locked: x.locked,
    })),
    screeningResponses,
    count: row.count,
    field: row.field,
    dateRange: row.dateRange as any,
    yearRange: row.yearRange as any,
    filterType: (row.filterType as any) ?? null,
    isYearRangeEnabled: row.isYearRangeEnabled,
    sortBy: row.sortBy,
    selectedRegions: (row.selectedRegions as any) ?? null,
    selectedCountryFocus: (row.selectedCountryFocus as any) ?? null,
    ratingRange: (row.ratingRange as any) ?? null,
    onlyRatedPapers: row.onlyRatedPapers,
    citesItemId: row.citesItemId,
    citedByItemId: row.citedByItemId,
    relatedToItemId: row.relatedToItemId,
    reviewFilter: row.reviewFilter,
    language: row.language,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listSearches(): Promise<SearchResultDTO[]> {
  const userId = await requireUser();
  const rows = await db
    .select()
    .from(s.searches)
    .where(eq(s.searches.userId, userId))
    .orderBy(desc(s.searches.createdAt));

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);

  const [qh, qqh, ssq, ssr] = await Promise.all([
    db
      .select()
      .from(s.searchQueryHistory)
      .where(inArray(s.searchQueryHistory.searchId, ids)),
    db
      .select()
      .from(s.searchQuestionHistory)
      .where(inArray(s.searchQuestionHistory.searchId, ids)),
    db
      .select()
      .from(s.searchScreeningQuestions)
      .where(inArray(s.searchScreeningQuestions.searchId, ids)),
    db
      .select()
      .from(s.searchScreeningResponses)
      .where(inArray(s.searchScreeningResponses.searchId, ids)),
  ]);

  const QH = new Map<string, { query: string; timestamp: string }[]>();
  qh.forEach((x) => {
    const a = QH.get(x.searchId) || [];
    a.push({ query: x.query, timestamp: x.timestamp.toISOString() });
    QH.set(x.searchId, a);
  });

  const QQH = new Map<string, { question: string; timestamp: string }[]>();
  qqh.forEach((x) => {
    const a = QQH.get(x.searchId) || [];
    a.push({ question: x.question, timestamp: x.timestamp.toISOString() });
    QQH.set(x.searchId, a);
  });

  const SSQ = new Map<
    string,
    { id: number; question: string; locked: boolean }[]
  >();
  ssq.forEach((x) => {
    const a = SSQ.get(x.searchId) || [];
    a.push({ id: x.id!, question: x.question, locked: x.locked });
    SSQ.set(x.searchId, a);
  });

  const SSR = new Map<
    string,
    Record<string, Record<string, boolean | null>>
  >();
  ssr.forEach((x) => {
    const perSearch =
      SSR.get(x.searchId) || (SSR.set(x.searchId, {}), SSR.get(x.searchId)!);
    perSearch[x.paperId] ||= {};
    perSearch[x.paperId][x.question] = x.response;
  });

  return rows.map((row) => ({
    id: row.id,
    query: row.query,
    queryHistory: QH.get(row.id) || [],
    questionHistory: QQH.get(row.id) || [],
    screeningQuestions: SSQ.get(row.id) || [],
    screeningResponses: SSR.get(row.id) || {},
    count: row.count,
    field: row.field,
    dateRange: row.dateRange as any,
    yearRange: row.yearRange as any,
    filterType: (row.filterType as any) ?? null,
    isYearRangeEnabled: row.isYearRangeEnabled,
    sortBy: row.sortBy,
    selectedRegions: (row.selectedRegions as any) ?? null,
    selectedCountryFocus: (row.selectedCountryFocus as any) ?? null,
    ratingRange: (row.ratingRange as any) ?? null,
    onlyRatedPapers: row.onlyRatedPapers,
    citesItemId: row.citesItemId,
    citedByItemId: row.citedByItemId,
    relatedToItemId: row.relatedToItemId,
    reviewFilter: row.reviewFilter,
    language: row.language,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function importSearches(data: any[]): Promise<number> {
  const userId = await requireUser();
  let imported = 0;
  const nowTs = now();

  for (const item of data) {
    const query = item.search_query || item.query || '';
    const count = typeof item.count === 'number' ? item.count : 0;
    const field = item.field || 'title_and_abstract';
    if (query === undefined || query === null || typeof count !== 'number') {
      continue;
    }
    const id = randomUUID();

    await db.insert(s.searches).values({
      id,
      userId,
      query,
      count,
      field,
      createdAt: nowTs,
      updatedAt: nowTs,
    });
    await db.insert(s.searchQueryHistory).values({
      searchId: id,
      query,
      timestamp: nowTs,
    });

    imported++;
  }

  return imported;
}

/* FOCUS MODE SETTINGS */

export async function getFocusModeSettings(): Promise<FocusModeSettingsDTO> {
  const userId = await requireUser();
  const [row] = await db
    .select()
    .from(s.focusModeSettings)
    .where(eq(s.focusModeSettings.userId, userId));
  return (
    (row && {
      fontSize: row.fontSize as any,
      maxContentWidth: row.maxContentWidth as any,
      lineHeight: row.lineHeight as any,
      showMetadata: row.showMetadata,
      compactMode: row.compactMode,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }) || {
      fontSize: 'base',
      maxContentWidth: 'medium',
      lineHeight: 'normal',
      showMetadata: true,
      compactMode: false,
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
    }
  );
}

export async function upsertFocusModeSettings(
  updates: Partial<FocusModeSettingsDTO>
) {
  const userId = await requireUser();
  await db
    .insert(s.focusModeSettings)
    .values({
      userId,
      fontSize: (updates.fontSize as any) ?? 'base',
      maxContentWidth: (updates.maxContentWidth as any) ?? 'medium',
      lineHeight: (updates.lineHeight as any) ?? 'normal',
      showMetadata: updates.showMetadata ?? true,
      compactMode: updates.compactMode ?? false,
    })
    .onConflictDoUpdate({
      target: s.focusModeSettings.userId,
      set: { ...updates, updatedAt: now() } as any,
    });
}

export async function resetFocusModeSettings() {
  const userId = await requireUser();
  await db
    .update(s.focusModeSettings)
    .set({
      fontSize: 'base',
      maxContentWidth: 'medium',
      lineHeight: 'normal',
      showMetadata: true,
      compactMode: false,
      updatedAt: now(),
    })
    .where(eq(s.focusModeSettings.userId, userId));
}

/* KEYWORD EXPANSION */

export async function listKeywords(): Promise<KeywordDTO[]> {
  const userId = await requireUser();
  const rows = await db
    .select()
    .from(s.keywords)
    .where(eq(s.keywords.userId, userId));
  return rows.map((r) => ({
    shorthand: r.shorthand,
    expansion: r.expansion,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function upsertKeyword(shorthand: string, expansion: string) {
  const userId = await requireUser();
  await db
    .insert(s.keywords)
    .values({ userId, shorthand, expansion })
    .onConflictDoUpdate({
      target: [s.keywords.userId, s.keywords.shorthand],
      set: { expansion, updatedAt: now() },
    });
}

export async function removeKeyword(shorthand: string) {
  const userId = await requireUser();
  await db
    .delete(s.keywords)
    .where(and(eq(s.keywords.userId, userId), eq(s.keywords.shorthand, shorthand)));
}

export async function clearKeywords() {
  const userId = await requireUser();
  await db.delete(s.keywords).where(eq(s.keywords.userId, userId));
}

/* AI CONFIG (NO SECRETS RETURNED) */

export async function getAIConfig(): Promise<AIConfigDTO> {
  const userId = await requireUser();
  const [row] = await db
    .select()
    .from(s.aiConfigs)
    .where(eq(s.aiConfigs.userId, userId));
  return (
    (row && {
      provider: row.provider as any,
      dollarsUsed: row.dollarsUsed,
      budget: row.budget,
      hasApiKey: !!row.apiKeyCiphertext,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }) || {
      provider: 'openai',
      dollarsUsed: '0',
      budget: '0',
      hasApiKey: false,
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
    }
  );
}

export async function setAIProvider(provider: 'openai' | 'google') {
  const userId = await requireUser();
  await db
    .insert(s.aiConfigs)
    .values({ userId, provider })
    .onConflictDoUpdate({
      target: s.aiConfigs.userId,
      set: { provider, updatedAt: now() },
    });
}

export async function setAIBudget(budget: number) {
  const userId = await requireUser();
  await db
    .insert(s.aiConfigs)
    .values({ userId, budget: String(budget) })
    .onConflictDoUpdate({
      target: s.aiConfigs.userId,
      set: { budget: String(budget), updatedAt: now() },
    });
}

export async function addAIDollarsUsed(amount: number) {
  const userId = await requireUser();
  await db
    .update(s.aiConfigs)
    .set({
      dollarsUsed: sql`${s.aiConfigs.dollarsUsed} + ${amount}`,
      updatedAt: now(),
    })
    .where(eq(s.aiConfigs.userId, userId));
}

export async function resetAIDollarsUsed() {
  const userId = await requireUser();
  await db
    .update(s.aiConfigs)
    .set({ dollarsUsed: '0', updatedAt: now() })
    .where(eq(s.aiConfigs.userId, userId));
}

export async function setAIKeyCiphertext(ciphertext: string | null) {
  const userId = await requireUser();
  await db
    .insert(s.aiConfigs)
    .values({ userId, apiKeyCiphertext: ciphertext ?? null })
    .onConflictDoUpdate({
      target: s.aiConfigs.userId,
      set: { apiKeyCiphertext: ciphertext ?? null, updatedAt: now() },
    });
}

export async function clearAIConfig() {
  const userId = await requireUser();
  await db
    .update(s.aiConfigs)
    .set({
      provider: 'openai',
      apiKeyCiphertext: null,
      dollarsUsed: '0',
      budget: '0',
      updatedAt: now(),
    })
    .where(eq(s.aiConfigs.userId, userId));
}

/* USER SCREENING QUESTIONS LIBRARY */

export async function listUserScreeningQuestions(): Promise<
  UserScreeningQuestionDTO[]
> {
  const userId = await requireUser();
  const rows = await db
    .select()
    .from(s.userScreeningQuestions)
    .where(eq(s.userScreeningQuestions.userId, userId));
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    type: r.type as any,
    question: r.question,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function addUserScreeningQuestion(input: {
  key: string;
  type: 'boolean' | 'number' | 'array' | 'string';
  question: string;
}): Promise<UserScreeningQuestionDTO> {
  const userId = await requireUser();
  const [row] = await db
    .insert(s.userScreeningQuestions)
    .values({
      userId,
      key: input.key,
      type: input.type,
      question: input.question,
    })
    .returning();
  return {
    id: row.id,
    key: row.key,
    type: row.type as any,
    question: row.question,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function clearUserScreeningQuestions() {
  const userId = await requireUser();
  await db
    .delete(s.userScreeningQuestions)
    .where(eq(s.userScreeningQuestions.userId, userId));
}

/* INITIAL HYDRATION (ONLY WHAT YOU LEFT UNCOMMENTED) */

export async function hydrateAll() {
  const [
    ratings,
    searches,
    focusSettings,
    keywords,
    aiConfig,
    userQuestions,
  ] = await Promise.all([
    getRatings(),
    listSearches(),
    getFocusModeSettings(),
    listKeywords(),
    getAIConfig(),
    listUserScreeningQuestions(),
  ]);

  return {
    ratings,
    searches,
    focusSettings,
    keywords,
    aiConfig,
    userQuestions,
  };
}