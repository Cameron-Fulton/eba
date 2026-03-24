/**
 * Tests for nk-vote-tracker.ts — core vote tracking for NK entries.
 * TDD: tests written first, then implementation.
 */

import {
  VoteContext,
  VoteMetrics,
  VoteReceipt,
  FRAMEWORK_TAGS,
  TIER_1_FRAMEWORKS,
  TIER_2_INTEGRATIONS,
  buildContextKeys,
  detectFrameworks,
  wilsonScore,
  resolveWilsonScore,
  incrementVotes,
  createVoteReceipts,
  applyVoteReceipts,
} from '../../src/pipeline/nk-vote-tracker';

import { NegativeKnowledgeEntry, NegativeKnowledgeStore } from '../../src/phase1/negative-knowledge';

// Helper to create a minimal NK entry
function makeEntry(overrides: Partial<NegativeKnowledgeEntry> & { vote_metrics?: VoteMetrics } = {}): NegativeKnowledgeEntry & { vote_metrics?: VoteMetrics } {
  return {
    id: overrides.id ?? 'nk_test_001',
    scenario: overrides.scenario ?? 'test scenario',
    attempt: overrides.attempt ?? 'test attempt',
    outcome: overrides.outcome ?? 'test outcome',
    solution: overrides.solution ?? 'test solution',
    tags: overrides.tags ?? ['jest', 'typescript'],
    timestamp: overrides.timestamp ?? '2026-03-24T00:00:00.000Z',
    ...('vote_metrics' in overrides ? { vote_metrics: overrides.vote_metrics } : {}),
  } as NegativeKnowledgeEntry & { vote_metrics?: VoteMetrics };
}

// ── Constants ──────────────────────────────────────────────

describe('Constants', () => {
  test('FRAMEWORK_TAGS contains expected tags', () => {
    expect(FRAMEWORK_TAGS).toBeInstanceOf(Set);
    expect(FRAMEWORK_TAGS.has('jest')).toBe(true);
    expect(FRAMEWORK_TAGS.has('react')).toBe(true);
    expect(FRAMEWORK_TAGS.has('docker')).toBe(true);
    expect(FRAMEWORK_TAGS.has('prisma')).toBe(true);
    expect(FRAMEWORK_TAGS.size).toBe(24);
  });

  test('TIER_1_FRAMEWORKS is subset of FRAMEWORK_TAGS', () => {
    for (const tag of TIER_1_FRAMEWORKS) {
      expect(FRAMEWORK_TAGS.has(tag)).toBe(true);
    }
    expect(TIER_1_FRAMEWORKS.size).toBe(8);
  });

  test('TIER_2_INTEGRATIONS is subset of FRAMEWORK_TAGS', () => {
    for (const tag of TIER_2_INTEGRATIONS) {
      expect(FRAMEWORK_TAGS.has(tag)).toBe(true);
    }
    expect(TIER_2_INTEGRATIONS.size).toBe(7);
  });

  test('TIER_1 and TIER_2 do not overlap', () => {
    for (const tag of TIER_1_FRAMEWORKS) {
      expect(TIER_2_INTEGRATIONS.has(tag)).toBe(false);
    }
  });
});

// ── buildContextKeys ───────────────────────────────────────

describe('buildContextKeys', () => {
  test('returns ["_default"] when no tags provided', () => {
    expect(buildContextKeys([], [])).toEqual(['_default']);
  });

  test('returns ["_default"] when all tags are empty strings', () => {
    expect(buildContextKeys(['', ''], [''])).toEqual(['_default']);
  });

  test('lowercases all tags', () => {
    const keys = buildContextKeys(['React'], ['JEST']);
    expect(keys).toContain('react');
    expect(keys).toContain('jest');
  });

  test('deduplicates tags', () => {
    const keys = buildContextKeys(['react'], ['react', 'jest']);
    const individual = keys.filter(k => !k.includes('+'));
    // react appears once, jest appears once
    expect(individual.filter(k => k === 'react').length).toBe(1);
    expect(individual.filter(k => k === 'jest').length).toBe(1);
  });

  test('sorts individual keys', () => {
    const keys = buildContextKeys(['react', 'jest'], []);
    const individual = keys.filter(k => !k.includes('+'));
    expect(individual).toEqual([...individual].sort());
  });

  test('no compound key when taskTags is empty — tier2 requires taskTags', () => {
    const keys = buildContextKeys(['react', 'prisma', 'jest', 'typescript'], []);
    const compound = keys.filter(k => k.includes('+'));
    // Empty taskTags means no tier2 tags; only tier1 (react) enters compoundParts
    // which is < 2, so no compound key forms
    expect(compound.length).toBe(0);
  });

  test('compound key includes max 1 tier1 framework', () => {
    // tier2 must come from taskTags
    const keys = buildContextKeys(['react', 'next'], ['prisma']);
    const compound = keys.filter(k => k.includes('+'));
    expect(compound.length).toBe(1);
    const parts = compound[0].split('+');
    const tier1Count = parts.filter(p => TIER_1_FRAMEWORKS.has(p)).length;
    expect(tier1Count).toBeLessThanOrEqual(1);
  });

  test('compound key caps at 4 tags', () => {
    // tier2 must come from taskTags
    const keys = buildContextKeys(
      ['react'],
      ['prisma', 'database', 'auth', 'oauth', 'cache', 'docker']
    );
    const compound = keys.filter(k => k.includes('+'));
    if (compound.length > 0) {
      const parts = compound[0].split('+');
      expect(parts.length).toBeLessThanOrEqual(4);
    }
  });

  test('no compound key when fewer than 2 tags after tiering', () => {
    const keys = buildContextKeys(['jest'], []);
    const compound = keys.filter(k => k.includes('+'));
    expect(compound.length).toBe(0);
  });

  test('compound key only from tier1+tier2, never tier3', () => {
    // Only tier3 tags (jest, eslint, typescript) — no compound
    const keys = buildContextKeys(['jest', 'eslint', 'typescript'], []);
    const compound = keys.filter(k => k.includes('+'));
    expect(compound.length).toBe(0);
  });

  test('compound key uses tier2 from taskTags', () => {
    const keys = buildContextKeys(['react'], ['prisma', 'database']);
    const compound = keys.filter(k => k.includes('+'));
    expect(compound.length).toBe(1);
    // Should have tier2 from taskTags and tier1 from project
    expect(compound[0]).toContain('react');
    expect(compound[0]).toContain('prisma');
  });

  test('compound key is sorted alphabetically', () => {
    // tier2 must come from taskTags
    const keys = buildContextKeys(['react'], ['prisma', 'auth']);
    const compound = keys.filter(k => k.includes('+'));
    if (compound.length > 0) {
      const parts = compound[0].split('+');
      expect(parts).toEqual([...parts].sort());
    }
  });

  test('filters empty strings', () => {
    const keys = buildContextKeys(['', 'react'], ['', 'jest']);
    expect(keys).not.toContain('');
  });

  test('single tag returns just that tag, no compound', () => {
    const keys = buildContextKeys(['react'], []);
    expect(keys).toEqual(['react']);
  });
});

// ── detectFrameworks ───────────────────────────────────────

describe('detectFrameworks', () => {
  test('returns empty array for nonexistent directory', () => {
    expect(detectFrameworks('/nonexistent/path')).toEqual([]);
  });

  test('returns empty array for directory without package.json', () => {
    const os = require('os');
    expect(detectFrameworks(os.tmpdir())).toEqual([]);
  });

  // Integration: reads real project package.json
  test('detects frameworks from current project', () => {
    const result = detectFrameworks(process.cwd());
    // This project uses jest and typescript at minimum
    expect(result).toContain('jest');
    expect(result).toContain('typescript');
  });

  test('strips scoped package prefixes', () => {
    // We test the logic by checking the real project which has @types/jest etc.
    const result = detectFrameworks(process.cwd());
    // Should not have @-prefixed names
    for (const fw of result) {
      expect(fw.startsWith('@')).toBe(false);
    }
  });
});

// ── wilsonScore ────────────────────────────────────────────

describe('wilsonScore', () => {
  test('returns 0 for zero total', () => {
    expect(wilsonScore(0, 0)).toBe(0);
  });

  test('returns 0 for 0 successes, 1 total', () => {
    const score = wilsonScore(0, 1);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(0.1);
  });

  test('returns high score for all successes', () => {
    const score = wilsonScore(100, 100);
    expect(score).toBeGreaterThan(0.9);
  });

  test('returns moderate score for 50/50', () => {
    const score = wilsonScore(50, 100);
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThan(0.6);
  });

  test('is lower bound — biased downward', () => {
    // 1/1 success should not be 1.0
    const score = wilsonScore(1, 1);
    expect(score).toBeLessThan(1.0);
  });

  test('custom z value changes result', () => {
    const low = wilsonScore(5, 10, 1.0);
    const high = wilsonScore(5, 10, 2.58);
    // Higher z → more conservative → lower bound is lower
    expect(high).toBeLessThan(low);
  });

  test('handles edge case: 1 success, 1 total', () => {
    const score = wilsonScore(1, 1);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

// ── resolveWilsonScore ─────────────────────────────────────

describe('resolveWilsonScore', () => {
  test('returns 0 when entry has no vote_metrics', () => {
    const entry = makeEntry();
    expect(resolveWilsonScore(entry as any, ['react'])).toBe(0);
  });

  test('returns score from compound key when available', () => {
    const entry = makeEntry({
      vote_metrics: {
        contexts: {
          'prisma+react': { successes: 8, total_attempts: 10 },
          'react': { successes: 3, total_attempts: 10 },
          '_default': { successes: 1, total_attempts: 10 },
        },
      },
    });
    const score = resolveWilsonScore(entry as any, ['react', 'prisma+react']);
    expect(score).toBeGreaterThan(0.4); // compound key with 8/10
  });

  test('falls back to best individual key when compound < 3 attempts', () => {
    const entry = makeEntry({
      vote_metrics: {
        contexts: {
          'prisma+react': { successes: 1, total_attempts: 2 }, // < 3
          'react': { successes: 7, total_attempts: 10 },
        },
      },
    });
    const score = resolveWilsonScore(entry as any, ['react', 'prisma+react']);
    const reactScore = wilsonScore(7, 10);
    expect(score).toBeCloseTo(reactScore, 5);
  });

  test('falls back to _default when no keys match', () => {
    const entry = makeEntry({
      vote_metrics: {
        contexts: {
          '_default': { successes: 5, total_attempts: 10 },
        },
      },
    });
    const score = resolveWilsonScore(entry as any, ['vue']);
    const defaultScore = wilsonScore(5, 10);
    expect(score).toBeCloseTo(defaultScore, 5);
  });

  test('returns 0 when _default also missing', () => {
    const entry = makeEntry({
      vote_metrics: {
        contexts: {},
      },
    });
    expect(resolveWilsonScore(entry as any, ['react'])).toBe(0);
  });

  test('chooses best individual key by score', () => {
    const entry = makeEntry({
      vote_metrics: {
        contexts: {
          'react': { successes: 9, total_attempts: 10 },
          'prisma': { successes: 3, total_attempts: 10 },
        },
      },
    });
    const score = resolveWilsonScore(entry as any, ['react', 'prisma']);
    const reactScore = wilsonScore(9, 10);
    expect(score).toBeCloseTo(reactScore, 5);
  });
});

// ── incrementVotes ─────────────────────────────────────────

describe('incrementVotes', () => {
  test('does not mutate original entry', () => {
    const entry = makeEntry({
      vote_metrics: {
        contexts: {
          'react': { successes: 5, total_attempts: 10 },
        },
      },
    });
    const original = JSON.parse(JSON.stringify(entry));
    incrementVotes(entry as any, ['react'], true);
    expect(entry).toEqual(original);
  });

  test('increments total_attempts on all keys', () => {
    const entry = makeEntry({
      vote_metrics: {
        contexts: {
          'react': { successes: 5, total_attempts: 10 },
          'jest': { successes: 3, total_attempts: 8 },
        },
      },
    });
    const result = incrementVotes(entry as any, ['react', 'jest'], false) as any;
    expect(result.vote_metrics.contexts['react'].total_attempts).toBe(11);
    expect(result.vote_metrics.contexts['jest'].total_attempts).toBe(9);
  });

  test('increments successes when succeeded=true', () => {
    const entry = makeEntry({
      vote_metrics: {
        contexts: {
          'react': { successes: 5, total_attempts: 10 },
        },
      },
    });
    const result = incrementVotes(entry as any, ['react'], true) as any;
    expect(result.vote_metrics.contexts['react'].successes).toBe(6);
    expect(result.vote_metrics.contexts['react'].total_attempts).toBe(11);
  });

  test('does not increment successes when succeeded=false', () => {
    const entry = makeEntry({
      vote_metrics: {
        contexts: {
          'react': { successes: 5, total_attempts: 10 },
        },
      },
    });
    const result = incrementVotes(entry as any, ['react'], false) as any;
    expect(result.vote_metrics.contexts['react'].successes).toBe(5);
    expect(result.vote_metrics.contexts['react'].total_attempts).toBe(11);
  });

  test('creates new context key if not present', () => {
    const entry = makeEntry({
      vote_metrics: {
        contexts: {},
      },
    });
    const result = incrementVotes(entry as any, ['vue'], true) as any;
    expect(result.vote_metrics.contexts['vue']).toEqual({
      successes: 1,
      total_attempts: 1,
    });
  });

  test('initializes vote_metrics when absent', () => {
    const entry = makeEntry();
    const result = incrementVotes(entry as any, ['react'], true) as any;
    expect(result.vote_metrics).toBeDefined();
    expect(result.vote_metrics.contexts['react']).toEqual({
      successes: 1,
      total_attempts: 1,
    });
  });

  test('deep copies contexts — nested mutation safety', () => {
    const entry = makeEntry({
      vote_metrics: {
        contexts: {
          'react': { successes: 5, total_attempts: 10 },
        },
      },
    });
    const result = incrementVotes(entry as any, ['react'], true) as any;
    // Mutating result should not affect original
    result.vote_metrics.contexts['react'].successes = 999;
    expect((entry as any).vote_metrics.contexts['react'].successes).toBe(5);
  });
});

// ── createVoteReceipts ─────────────────────────────────────

describe('createVoteReceipts', () => {
  test('returns empty array for empty entries', () => {
    expect(createVoteReceipts([], process.cwd(), true)).toEqual([]);
  });

  test('creates receipts with correct structure', () => {
    const entries = [makeEntry({ tags: ['react', 'jest'] })];
    const receipts = createVoteReceipts(entries as any, process.cwd(), true);
    expect(receipts.length).toBe(1);
    expect(receipts[0].nk_id).toBe('nk_test_001');
    expect(receipts[0].succeeded).toBe(true);
    expect(receipts[0].timestamp).toBeDefined();
    expect(Array.isArray(receipts[0].context_keys)).toBe(true);
  });

  test('deduplicates entries by id', () => {
    const entry = makeEntry();
    const receipts = createVoteReceipts([entry, entry] as any, process.cwd(), true);
    expect(receipts.length).toBe(1);
  });

  test('context_keys filter entry tags against FRAMEWORK_TAGS', () => {
    const entry = makeEntry({ tags: ['react', 'some-random-tag', 'jest'] });
    const receipts = createVoteReceipts([entry] as any, process.cwd(), false);
    // context_keys should include react and jest (framework tags) but not some-random-tag
    expect(receipts[0].context_keys).toContain('react');
    expect(receipts[0].context_keys).toContain('jest');
    expect(receipts[0].context_keys).not.toContain('some-random-tag');
  });

  test('sets succeeded=false correctly', () => {
    const entry = makeEntry();
    const receipts = createVoteReceipts([entry] as any, process.cwd(), false);
    expect(receipts[0].succeeded).toBe(false);
  });
});

// ── applyVoteReceipts ──────────────────────────────────────

describe('applyVoteReceipts', () => {
  function makeStore(): NegativeKnowledgeStore {
    const os = require('os');
    const path = require('path');
    const fs = require('fs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nk-vote-test-'));
    return new NegativeKnowledgeStore(dir);
  }

  test('returns {applied:0, skipped:0} for empty receipts', () => {
    const store = makeStore();
    const result = applyVoteReceipts(store, []);
    expect(result).toEqual({ applied: 0, skipped: 0 });
  });

  test('applies vote to existing entry', () => {
    const store = makeStore();
    const entry = store.add({
      scenario: 'test',
      attempt: 'test',
      outcome: 'test',
      solution: 'test',
      tags: ['react'],
    });
    const receipt: VoteReceipt = {
      nk_id: entry.id,
      context_keys: ['react'],
      succeeded: true,
      timestamp: new Date().toISOString(),
    };
    const result = applyVoteReceipts(store, [receipt]);
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(0);
  });

  test('skips and warns for missing entries', () => {
    const store = makeStore();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const receipt: VoteReceipt = {
      nk_id: 'nonexistent_id',
      context_keys: ['react'],
      succeeded: true,
      timestamp: new Date().toISOString(),
    };
    const result = applyVoteReceipts(store, [receipt]);
    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('handles mix of found and missing entries', () => {
    const store = makeStore();
    const entry = store.add({
      scenario: 'test',
      attempt: 'test',
      outcome: 'test',
      solution: 'test',
      tags: ['react'],
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const receipts: VoteReceipt[] = [
      { nk_id: entry.id, context_keys: ['react'], succeeded: true, timestamp: new Date().toISOString() },
      { nk_id: 'missing_id', context_keys: ['react'], succeeded: false, timestamp: new Date().toISOString() },
    ];
    const result = applyVoteReceipts(store, receipts);
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(1);
    warnSpy.mockRestore();
  });
});
