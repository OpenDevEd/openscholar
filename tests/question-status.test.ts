import { describe, it, expect } from 'vitest';
import {
  statusFromCompletion,
  getAnswerPercentage,
  STATUS_DOT_COLORS,
  STATUS_DOT_LABELS,
} from '../lib/extraction/question-status';

describe('statusFromCompletion', () => {
  it('returns complete when answered === total and total > 0', () => {
    expect(statusFromCompletion(10, 10)).toBe('complete');
  });

  it('returns partial when answered > 0 and answered < total', () => {
    expect(statusFromCompletion(5, 10)).toBe('partial');
  });

  it('returns partial when answered is 1', () => {
    expect(statusFromCompletion(1, 10)).toBe('partial');
  });

  it('returns empty when answered === 0', () => {
    expect(statusFromCompletion(0, 10)).toBe('empty');
  });

  it('returns empty when total === 0 (edge case)', () => {
    expect(statusFromCompletion(0, 0)).toBe('empty');
  });

  it('returns empty when total === 0 even if answered > 0', () => {
    expect(statusFromCompletion(10, 0)).toBe('empty');
  });
});

describe('getAnswerPercentage', () => {
  it('returns 0 when total === 0 (not NaN)', () => {
    expect(getAnswerPercentage(0, 0)).toBe(0);
  });

  it('returns 50 for (5, 10)', () => {
    expect(getAnswerPercentage(5, 10)).toBe(50);
  });

  it('returns 100 for (10, 10)', () => {
    expect(getAnswerPercentage(10, 10)).toBe(100);
  });

  it('returns 43 for (3, 7) — Math.round', () => {
    expect(getAnswerPercentage(3, 7)).toBe(43);
  });

  it('returns 33 for (1, 3) — Math.round', () => {
    expect(getAnswerPercentage(1, 3)).toBe(33);
  });
});

describe('STATUS_DOT_COLORS', () => {
  it('complete matches CITATION_STATUS_COLORS.grounded (#10b981) — no color drift', () => {
    expect(STATUS_DOT_COLORS.complete).toBe('#10b981');
  });

  it('partial matches CITATION_STATUS_COLORS.best_effort (#f59e0b)', () => {
    expect(STATUS_DOT_COLORS.partial).toBe('#f59e0b');
  });

  it('empty is grey (#d1d5db)', () => {
    expect(STATUS_DOT_COLORS.empty).toBe('#d1d5db');
  });
});

describe('STATUS_DOT_LABELS', () => {
  it('complete maps to statusDotComplete', () => {
    expect(STATUS_DOT_LABELS.complete).toBe('statusDotComplete');
  });

  it('partial maps to statusDotPartial', () => {
    expect(STATUS_DOT_LABELS.partial).toBe('statusDotPartial');
  });

  it('empty maps to statusDotEmpty', () => {
    expect(STATUS_DOT_LABELS.empty).toBe('statusDotEmpty');
  });
});
