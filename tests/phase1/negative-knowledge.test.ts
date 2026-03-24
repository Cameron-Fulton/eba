import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { NegativeKnowledgeStore, parseNKMarkdown, VoteMetrics } from '../../src/phase1/negative-knowledge';

describe('Negative Knowledge Store', () => {
  let store: NegativeKnowledgeStore;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nk-test-'));
    store = new NegativeKnowledgeStore(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('adds and retrieves an entry', () => {
    const entry = store.add({
      scenario: 'Deploy to prod',
      attempt: 'Used hot reload',
      outcome: 'Crashed the server',
      solution: 'Use blue-green deployment',
      tags: ['deploy', 'production'],
    });

    expect(entry.id).toMatch(/^nk_/);
    expect(store.get(entry.id)).toEqual(entry);
  });

  test('removes an entry', () => {
    const entry = store.add({
      scenario: 'Test',
      attempt: 'Approach A',
      outcome: 'Failed',
      solution: 'Use Approach B',
      tags: ['test'],
    });

    expect(store.remove(entry.id)).toBe(true);
    expect(store.get(entry.id)).toBeUndefined();
    expect(store.remove(entry.id)).toBe(false);
  });

  test('updates an entry', () => {
    const entry = store.add({
      scenario: 'Original',
      attempt: 'First try',
      outcome: 'Failed',
      solution: 'Try harder',
      tags: ['test'],
    });

    const updated = store.update(entry.id, { solution: 'Use a different approach' });
    expect(updated?.solution).toBe('Use a different approach');
    expect(updated?.scenario).toBe('Original');
  });

  test('returns undefined when updating non-existent entry', () => {
    expect(store.update('fake_id', { solution: 'nope' })).toBeUndefined();
  });

  test('searches by keyword', () => {
    store.add({
      scenario: 'Database migration failed',
      attempt: 'Ran ALTER TABLE',
      outcome: 'Timeout',
      solution: 'Use batch migration',
      tags: ['database'],
    });
    store.add({
      scenario: 'API rate limited',
      attempt: 'Burst requests',
      outcome: 'Rate limited',
      solution: 'Add backoff',
      tags: ['api'],
    });

    const results = store.searchByKeyword('database');
    expect(results).toHaveLength(1);
    expect(results[0].scenario).toContain('Database');
  });

  test('searches by tags', () => {
    store.add({
      scenario: 'Scenario 1',
      attempt: 'A',
      outcome: 'Fail',
      solution: 'B',
      tags: ['deploy', 'ci'],
    });
    store.add({
      scenario: 'Scenario 2',
      attempt: 'C',
      outcome: 'Fail',
      solution: 'D',
      tags: ['test'],
    });

    const results = store.searchByTags(['deploy']);
    expect(results).toHaveLength(1);
    expect(results[0].tags).toContain('deploy');
  });

  test('saves to disk and loads back', () => {
    store.add({
      scenario: 'Persistent entry',
      attempt: 'Wrote to disk',
      outcome: 'Saved',
      solution: 'Read from disk',
      tags: ['persistence'],
    });

    store.saveToDisk();

    const store2 = new NegativeKnowledgeStore(tempDir);
    store2.loadFromDisk();

    const all = store2.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].scenario).toBe('Persistent entry');
  });

  test('generates valid markdown', () => {
    const entry = store.add({
      scenario: 'Test scenario',
      attempt: 'Test attempt',
      outcome: 'Test outcome',
      solution: 'Test solution',
      tags: ['tag1', 'tag2'],
    });

    const md = store.toMarkdown(entry);
    expect(md).toContain('# Test scenario');
    expect(md).toContain('## Attempt');
    expect(md).toContain('## Solution');
    expect(md).toContain('tag1, tag2');
  });

  test('toMarkdown includes Vote Metrics line when vote_metrics set', () => {
    const entry = store.add({
      scenario: 'Vote test',
      attempt: 'a',
      outcome: 'b',
      solution: 'c',
      tags: ['t1'],
    });
    entry.vote_metrics = {
      contexts: {
        jest: { successes: 2, total_attempts: 3 },
        next: { successes: 1, total_attempts: 2 },
        _default: { successes: 0, total_attempts: 0 },
      },
    };
    const md = store.toMarkdown(entry);
    expect(md).toContain('**Vote Metrics:** _default: 0/0, jest: 2/3, next: 1/2');
  });

  test('toMarkdown omits Vote Metrics line when vote_metrics undefined', () => {
    const entry = store.add({
      scenario: 'No votes',
      attempt: 'a',
      outcome: 'b',
      solution: 'c',
      tags: ['t1'],
    });
    const md = store.toMarkdown(entry);
    expect(md).not.toContain('Vote Metrics');
  });

  test('parseNKMarkdown reads vote_metrics from markdown', () => {
    const entry = store.add({
      scenario: 'Parse test',
      attempt: 'a',
      outcome: 'b',
      solution: 'c',
      tags: ['t1'],
    });
    entry.vote_metrics = {
      contexts: {
        jest: { successes: 2, total_attempts: 3 },
        next: { successes: 1, total_attempts: 2 },
      },
    };
    const md = store.toMarkdown(entry);
    const parsed = parseNKMarkdown(md, 'fallback');
    expect(parsed).not.toBeNull();
    expect(parsed!.vote_metrics).toEqual({
      contexts: {
        jest: { successes: 2, total_attempts: 3 },
        next: { successes: 1, total_attempts: 2 },
      },
    });
  });

  test('parseNKMarkdown returns undefined vote_metrics when line missing', () => {
    const entry = store.add({
      scenario: 'No vote line',
      attempt: 'a',
      outcome: 'b',
      solution: 'c',
      tags: ['t1'],
    });
    const md = store.toMarkdown(entry);
    const parsed = parseNKMarkdown(md, 'fallback');
    expect(parsed).not.toBeNull();
    expect(parsed!.vote_metrics).toBeUndefined();
  });

  test('round-trip: toMarkdown -> parseNKMarkdown preserves vote_metrics', () => {
    const entry = store.add({
      scenario: 'Round trip',
      attempt: 'attempt text',
      outcome: 'outcome text',
      solution: 'solution text',
      tags: ['jest', 'react'],
    });
    const vm: VoteMetrics = {
      contexts: {
        _default: { successes: 5, total_attempts: 10 },
        jest: { successes: 3, total_attempts: 7 },
        'jest+react': { successes: 1, total_attempts: 2 },
      },
    };
    entry.vote_metrics = vm;
    const md = store.toMarkdown(entry);
    const parsed = parseNKMarkdown(md, 'fallback');
    expect(parsed).not.toBeNull();
    expect(parsed!.vote_metrics).toEqual(vm);
    expect(parsed!.scenario).toBe('Round trip');
    expect(parsed!.tags).toEqual(['jest', 'react']);
  });

  test('update() preserves vote_metrics via spread', () => {
    const entry = store.add({
      scenario: 'Update test',
      attempt: 'a',
      outcome: 'b',
      solution: 'c',
      tags: ['t1'],
    });
    entry.vote_metrics = {
      contexts: { jest: { successes: 1, total_attempts: 1 } },
    };
    // Re-set it in the store so update can find it with vote_metrics
    (store as any).entries.set(entry.id, entry);
    const updated = store.update(entry.id, { solution: 'new solution' });
    expect(updated).toBeDefined();
    expect(updated!.solution).toBe('new solution');
    expect(updated!.vote_metrics).toEqual({
      contexts: { jest: { successes: 1, total_attempts: 1 } },
    });
  });
});
