// ============================================================================
// REPOSITORY TYPES AND UTILITIES
// ============================================================================

// Search Term Types
export type SearchTerm = {
  term: string;
  enabled: boolean;
};

export type SearchTermData = SearchTerm | string; // For backward compatibility

// Screening Question Types
export type ScreeningQuestion = {
  id: string;
  key: string;
  type: 'boolean' | 'string' | 'number' | 'array';
  question: string;
};

// Data Extraction Question Types
export type DataExtractionQuestion = {
  id: string;
  key: string;
  type: 'boolean' | 'string' | 'number' | 'array';
  question: string;
};

// Review Types
export type ReviewStatus = 'draft' | 'in_progress' | 'completed' | 'paused' | 'cancelled';
export type Step = 'research_question' | 'search_terms' | 'screening_questions' | 'data_extraction_questions' | 'search_execution' | 'screening' | 'data_extraction' | 'completed';

// Step Configuration - Centralized DRY constants
export const STEP_ORDER: Step[] = [
  "research_question",
  "search_terms",
  "screening_questions",
  "data_extraction_questions",
  "search_execution"
];

export const STEP_LABELS: Record<Step, string> = {
  research_question: "Research Question",
  search_terms: "Search Terms",
  screening_questions: "Screening Questions",
  data_extraction_questions: "Data Extraction Questions",
  search_execution: "Systematic Review Process",
  screening: "Screening", // Kept for backward compatibility
  data_extraction: "Data Extraction", // Kept for backward compatibility
  completed: "Completed" // Kept for backward compatibility
};

export const TOTAL_STEPS = STEP_ORDER.length;

// Step Navigation Utilities
export function getStepIndex(step: Step): number {
  return STEP_ORDER.indexOf(step);
}

export function getNextStep(currentStep: Step): Step | null {
  const currentIndex = STEP_ORDER.indexOf(currentStep);
  if (currentIndex < STEP_ORDER.length - 1) {
    return STEP_ORDER[currentIndex + 1];
  }
  return null;
}

export function getPreviousStep(currentStep: Step): Step | null {
  const currentIndex = STEP_ORDER.indexOf(currentStep);
  if (currentIndex > 0) {
    return STEP_ORDER[currentIndex - 1];
  }
  return null;
}

export function isFirstStep(step: Step): boolean {
  return step === STEP_ORDER[0];
}

export function isLastStep(step: Step): boolean {
  return step === STEP_ORDER[STEP_ORDER.length - 1];
}

// Utility Functions
export function normalizeSearchTerms(data: SearchTermData[] | null | undefined): SearchTerm[] {
  if (!data) return [];

  return data.map(item => {
    if (typeof item === 'string') {
      // Convert old format to new format
      return { term: item, enabled: true };
    }
    return item;
  });
}

export function createSearchTerm(term: string, enabled: boolean = true): SearchTerm {
  return { term, enabled };
}

export function createScreeningQuestion(
  question: string,
  type: 'boolean' | 'string' | 'number' | 'array' = 'boolean'
): ScreeningQuestion {
  return {
    id: `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    key: question.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_'),
    type,
    question: question.trim()
  };
}

export function createDataExtractionQuestion(
  question: string,
  type: 'boolean' | 'string' | 'number' | 'array' = 'boolean'
): DataExtractionQuestion {
  return {
    id: `deq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    key: question.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_'),
    type,
    question: question.trim()
  };
}

// Type Guards
export function isSearchTermObject(item: SearchTermData): item is SearchTerm {
  return typeof item === 'object' && item !== null && 'term' in item && 'enabled' in item;
}

export function isSearchTermString(item: SearchTermData): item is string {
  return typeof item === 'string';
}

// Validation Functions
export function validateSearchTerm(term: SearchTerm): boolean {
  return !!(term.term && typeof term.term === 'string' && typeof term.enabled === 'boolean');
}

export function validateScreeningQuestion(question: ScreeningQuestion): boolean {
  return !!(
    question.id &&
    question.key &&
    question.question &&
    ['boolean', 'string', 'number', 'array'].includes(question.type)
  );
}

export function validateDataExtractionQuestion(question: DataExtractionQuestion): boolean {
  return !!(
    question.id &&
    question.key &&
    question.question &&
    ['boolean', 'string', 'number', 'array'].includes(question.type)
  );
}

// Mock Data Generators (for development)
export function generateMockSearchTerms(): SearchTerm[] {
  const mockTerms = [
    '("social media" OR "social network*" OR "online platform*" OR "digital media") AND ("adolescent*" OR "teenager*" OR "youth" OR "young people") AND ("mental health" OR "psychological wellbeing" OR "depression" OR "anxiety")',
    '("Facebook" OR "Instagram" OR "TikTok" OR "Snapchat" OR "Twitter") AND ("teen*" OR "adolescent*") AND ("mental health" OR "wellbeing" OR "psychological impact")',
    '(("screen time" OR "digital usage") AND ("excessive" OR "prolonged")) AND ("adolescent mental health" OR "teen depression" OR "youth anxiety")',
    '("cyberbullying" OR "online harassment") AND ("adolescent*" OR "teenager*") AND ("mental health outcomes" OR "psychological effects")',
    '(("social comparison" OR "peer pressure") AND ("Instagram" OR "TikTok")) AND ("adolescent*" OR "teen*") AND ("self-esteem" OR "body image" OR "mental health")',
    '("intervention*" OR "treatment*") AND (("cognitive behavioral therapy" OR "CBT") AND ("digital" OR "online")) AND ("adolescent*" OR "teen*") AND "mental health"',
    '(("parental control*" OR "digital parenting") AND ("social media" OR "screen time")) AND ("adolescent*" OR "teen*") AND ("wellbeing" OR "mental health")',
    '("longitudinal stud*" OR "cohort stud*") AND (("social media use" OR "digital engagement") AND ("frequency" OR "duration")) AND ("adolescent development" OR "teen mental health")'
  ];

  return mockTerms.map(term => createSearchTerm(term, true));
}

export function generateMockScreeningQuestions(): string[] {
  return [
    "Does this study focus on social media platforms (e.g., Facebook, Instagram, TikTok, Twitter, Snapchat)?",
    "Does this research involve adolescents, teenagers, or young people (ages 10-24)?",
    "Does this study examine mental health outcomes (e.g., depression, anxiety, wellbeing, psychological distress)?",
    "Is this an empirical study with quantitative or qualitative data (not just a review or opinion piece)?",
    "Does this study measure or assess the relationship between social media use and mental health?",
    "Is this study published in a peer-reviewed journal or conference?",
    "Does this research include measures of social media usage patterns, frequency, or duration?",
    "Does this study control for or consider potential confounding variables?"
  ];
}

export function generateMockDataExtractionQuestions(): ScreeningQuestion[] {
  const mockQuestions = [
    { question: "Is this an empirical study with quantitative or qualitative data collection?", type: 'boolean' as const },
    { question: "What is the sample size of participants in this study?", type: 'number' as const },
    { question: "What research methodology was used (e.g., RCT, cross-sectional, longitudinal)?", type: 'string' as const },
    { question: "Which social media platforms are mentioned or studied?", type: 'array' as const },
    { question: "Is this study published in a peer-reviewed journal?", type: 'boolean' as const },
    { question: "What year was this study published?", type: 'number' as const },
    { question: "What mental health outcomes are measured (e.g., depression, anxiety, wellbeing)?", type: 'array' as const },
    { question: "Describe the overall study design and approach used by the researchers.", type: 'string' as const }
  ];

  return mockQuestions.map(q => createDataExtractionQuestion(q.question, q.type));
}

// Export everything as a namespace for convenience
export const Repo = {
  utils: {
    normalizeSearchTerms,
    createSearchTerm,
    createScreeningQuestion,
    createDataExtractionQuestion,
    isSearchTermObject,
    isSearchTermString,
    validateSearchTerm,
    validateScreeningQuestion,
    validateDataExtractionQuestion
  },
  mock: {
    generateMockSearchTerms,
    generateMockScreeningQuestions,
    generateMockDataExtractionQuestions
  }
};
