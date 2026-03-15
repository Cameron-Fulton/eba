import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { NegativeKnowledgeStore } from '../../src/phase1/negative-knowledge';

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
});
