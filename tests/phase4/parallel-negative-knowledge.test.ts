import { ParallelNegativeKnowledge } from '../../src/phase4/parallel-negative-knowledge';
import { NegativeKnowledgeStore } from '../../src/phase1/negative-knowledge';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

describe('Parallel Negative Knowledge', () => {
  let store: NegativeKnowledgeStore;
  let pnk: ParallelNegativeKnowledge;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnk-test-'));
    store = new NegativeKnowledgeStore(tempDir);
    pnk = new ParallelNegativeKnowledge(store);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('checks store before attempting work', async () => {
    store.add({
      scenario: 'Fix login',
      attempt: 'Used session storage',
      outcome: 'Failed',
      solution: 'Use cookies instead',
      tags: ['auth'],
    });

    const entries = await pnk.checkBeforeAttempt('login');
    expect(entries).toHaveLength(1);
    expect(entries[0].attempt).toBe('Used session storage');
  });

  test('returns avoided approaches', async () => {
    store.add({
      scenario: 'Optimize query',
      attempt: 'Added index on column A',
      outcome: 'No improvement',
      solution: 'Rewrite query',
      tags: ['db'],
    });

    const avoided = await pnk.getAvoidedApproaches('query');
    expect(avoided).toContain('Added index on column A');
  });

  test('records failed attempt and adds to negative knowledge', async () => {
    await pnk.recordAttempt({
      thread_id: 'thread_1',
      task: 'Fix performance',
      approach: 'Cached everything',
      avoided_approaches: [],
      result: 'failure',
      timestamp: new Date().toISOString(),
    });

    const entries = store.searchByKeyword('performance');
    expect(entries).toHaveLength(1);
    expect(entries[0].attempt).toBe('Cached everything');
  });

  test('successful attempt does not add to negative knowledge', async () => {
    await pnk.recordAttempt({
      thread_id: 'thread_2',
      task: 'Build feature',
      approach: 'Good approach',
      avoided_approaches: [],
      result: 'success',
      timestamp: new Date().toISOString(),
    });

    const entries = store.searchByKeyword('feature');
    expect(entries).toHaveLength(0);
  });

  test('runs parallel tasks avoiding known failures', async () => {
    store.add({
      scenario: 'Deploy app',
      attempt: 'Hot reload',
      outcome: 'Crashed',
      solution: 'Blue-green',
      tags: ['deploy'],
    });

    const results = await pnk.runParallelTasks([
      {
        thread_id: 't1',
        task: 'Deploy app',
        approaches: ['Hot reload', 'Blue-green deploy', 'Rolling update'],
        execute: async (approach) => approach === 'Blue-green deploy',
      },
      {
        thread_id: 't2',
        task: 'Scale workers',
        approaches: ['Add more containers', 'Vertical scaling'],
        execute: async () => true,
      },
    ]);

    expect(results).toHaveLength(2);

    // t1 should have avoided 'Hot reload' and used 'Blue-green deploy'
    const t1 = results.find(r => r.thread_id === 't1')!;
    expect(t1.approach).toBe('Blue-green deploy');
    expect(t1.result).toBe('success');
    expect(t1.avoided_approaches).toContain('Hot reload');

    // t2 should work normally
    const t2 = results.find(r => r.thread_id === 't2')!;
    expect(t2.result).toBe('success');
  });

  test('handles task with no viable approaches', async () => {
    store.add({
      scenario: 'Fix bug',
      attempt: 'Approach A',
      outcome: 'Failed',
      solution: 'N/A',
      tags: ['bug'],
    });

    const results = await pnk.runParallelTasks([
      {
        thread_id: 't1',
        task: 'Fix bug',
        approaches: ['Approach A'], // Only approach is already failed
        execute: async () => true,
      },
    ]);

    expect(results[0].approach).toBe('none_available');
    expect(results[0].result).toBe('failure');
  });

  test('concurrent reads are safe', async () => {
    store.add({
      scenario: 'Shared task',
      attempt: 'Bad approach',
      outcome: 'Failed',
      solution: 'Good approach',
      tags: ['shared'],
    });

    // Run 10 concurrent reads
    const promises = Array.from({ length: 10 }, (_, i) =>
      pnk.checkBeforeAttempt('Shared task')
    );

    const results = await Promise.all(promises);
    expect(results.every(r => r.length === 1)).toBe(true);
  });

  test('tracks all attempts', async () => {
    await pnk.recordAttempt({
      thread_id: 't1',
      task: 'Task A',
      approach: 'Approach 1',
      avoided_approaches: [],
      result: 'success',
      timestamp: new Date().toISOString(),
    });
    await pnk.recordAttempt({
      thread_id: 't2',
      task: 'Task B',
      approach: 'Approach 2',
      avoided_approaches: [],
      result: 'failure',
      timestamp: new Date().toISOString(),
    });

    expect(pnk.getAttempts()).toHaveLength(2);
  });
});
