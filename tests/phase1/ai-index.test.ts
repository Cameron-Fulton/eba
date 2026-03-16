import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AIIndex } from '../../src/phase1/ai-index';
import { NegativeKnowledgeStore, type NegativeKnowledgeEntry } from '../../src/phase1/negative-knowledge';

describe('AIIndex', () => {
  let tempDir: string;
  let dbPath: string;
  let solutionsDir: string;
  let index: AIIndex;

  function parseMarkdown(content: string, fallbackId: string): NegativeKnowledgeEntry | null {
    const lines = content.split('\n');
    const scenarioMatch = lines[0]?.match(/^# (.+)$/);
    if (!scenarioMatch) return null;

    const idMatch = content.match(/\*\*ID:\*\* (.+)/);
    const dateMatch = content.match(/\*\*Date:\*\* (.+)/);
    const tagsMatch = content.match(/\*\*Tags:\*\* (.+)/);

    const attemptIdx = lines.findIndex(l => l === '## Attempt');
    const outcomeIdx = lines.findIndex(l => l === '## Outcome');
    const solutionIdx = lines.findIndex(l => l === '## Solution');

    const attempt = attemptIdx >= 0 && outcomeIdx >= 0
      ? lines.slice(attemptIdx + 1, outcomeIdx).join('\n').trim()
      : '';
    const outcome = outcomeIdx >= 0 && solutionIdx >= 0
      ? lines.slice(outcomeIdx + 1, solutionIdx).join('\n').trim()
      : '';
    const solution = solutionIdx >= 0
      ? lines.slice(solutionIdx + 1).join('\n').trim()
      : '';

    return {
      id: idMatch?.[1] ?? fallbackId,
      scenario: scenarioMatch[1],
      attempt,
      outcome,
      solution,
      tags: tagsMatch?.[1]?.split(', ').filter(Boolean) ?? [],
      timestamp: dateMatch?.[1] ?? new Date().toISOString(),
    };
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-index-test-'));
    dbPath = path.join(tempDir, '.ai_index', 'index.db');
    solutionsDir = path.join(tempDir, 'solutions');
    index = new AIIndex(dbPath);
  });

  afterEach(() => {
    try {
      index.close();
    } catch {
      // no-op
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('constructor creates DB file and tables without error', () => {
    expect(fs.existsSync(path.dirname(dbPath))).toBe(true);
    expect(fs.existsSync(dbPath)).toBe(true);
    expect(index.search('anything')).toEqual([]);
  });

  test('index() + search() finds entries by scenario/attempt/outcome/solution/tags', () => {
    const entry: NegativeKnowledgeEntry = {
      id: 'nk_fts_1',
      scenario: 'migration strategy failed badly',
      attempt: 'attempted risky command execution',
      outcome: 'caused production outage event',
      solution: 'phased rollout approach worked',
      tags: ['tagepsilon', 'ops'],
      timestamp: new Date().toISOString(),
    };

    index.index(entry);

    expect(index.search('migration')).toHaveLength(1);
    expect(index.search('attempted')).toHaveLength(1);
    expect(index.search('outage')).toHaveLength(1);
    expect(index.search('phased')).toHaveLength(1);
    expect(index.search('tagepsilon')).toHaveLength(1);
  });

  test('search() with no match returns empty array', () => {
    index.index({
      id: 'nk_no_match',
      scenario: 'Known scenario',
      attempt: 'Known attempt',
      outcome: 'Known outcome',
      solution: 'Known solution',
      tags: ['known'],
      timestamp: new Date().toISOString(),
    });

    expect(index.search('definitely-not-present')).toEqual([]);
  });

  test('search() with empty string returns empty array', () => {
    expect(index.search('')).toEqual([]);
    expect(index.search('   ')).toEqual([]);
  });

  test('remove() removes indexed entry from search results', () => {
    const entry: NegativeKnowledgeEntry = {
      id: 'nk_remove_1',
      scenario: 'Remove me scenario',
      attempt: 'Remove me attempt',
      outcome: 'Remove me outcome',
      solution: 'Remove me solution',
      tags: ['removetestlabel'],
      timestamp: new Date().toISOString(),
    };

    index.index(entry);
    expect(index.search('removetestlabel')).toHaveLength(1);

    index.remove(entry.id);
    expect(index.search('removetestlabel')).toEqual([]);
  });

  test('re-indexing same id updates searchable content', () => {
    const entry: NegativeKnowledgeEntry = {
      id: 'nk_update_1',
      scenario: 'oldscenarioterm unique',
      attempt: 'Old attempt',
      outcome: 'Old outcome',
      solution: 'Old solution',
      tags: ['oldtagvalue'],
      timestamp: new Date().toISOString(),
    };

    index.index(entry);
    expect(index.search('oldscenarioterm')).toHaveLength(1);

    const updated: NegativeKnowledgeEntry = {
      ...entry,
      scenario: 'newscenarioterm unique',
      tags: ['newtagvalue'],
    };

    index.index(updated);

    expect(index.search('newscenarioterm')).toHaveLength(1);
    expect(index.search('newtagvalue')).toHaveLength(1);
    expect(index.search('oldscenarioterm')).toEqual([]);
    expect(index.search('oldtagvalue')).toEqual([]);
  });

  test('rebuildFromDisk() indexes markdown files and returns count', () => {
    fs.mkdirSync(solutionsDir, { recursive: true });

    const store = new NegativeKnowledgeStore(solutionsDir);
    const a = store.add({
      scenario: 'Disk scenario one',
      attempt: 'Disk attempt one',
      outcome: 'Disk outcome one',
      solution: 'Disk solution one',
      tags: ['diskone'],
    });
    const b = store.add({
      scenario: 'Disk scenario two',
      attempt: 'Disk attempt two',
      outcome: 'Disk outcome two',
      solution: 'Disk solution two',
      tags: ['disktwo'],
    });
    store.saveToDisk();

    const count = index.rebuildFromDisk(solutionsDir, parseMarkdown);

    expect(count).toBe(2);
    expect(index.search('diskone')[0].id).toBe(a.id);
    expect(index.search('disktwo')[0].id).toBe(b.id);
  });

  test('search() with bad FTS5 syntax does not throw and returns []', () => {
    index.index({
      id: 'nk_bad_query',
      scenario: 'Any scenario',
      attempt: 'Any attempt',
      outcome: 'Any outcome',
      solution: 'Any solution',
      tags: ['any'],
      timestamp: new Date().toISOString(),
    });

    expect(() => index.search('"unbalanced')).not.toThrow();
    expect(index.search('"unbalanced')).toEqual([]);
  });

  test('close() then search() is graceful', () => {
    index.close();
    expect(() => index.search('anything')).not.toThrow();
    expect(index.search('anything')).toEqual([]);
  });

  test('NegativeKnowledgeStore.searchByKeyword uses FTS when initIndex() is called', () => {
    const store = new NegativeKnowledgeStore(solutionsDir);
    store.initIndex(dbPath);

    store.add({
      scenario: 'automation deployment strategy',
      attempt: 'Tried manual rollout',
      outcome: 'Error-prone steps',
      solution: 'Automate deployment pipeline',
      tags: ['release', 'ops'],
    });
    store.add({
      scenario: 'unrelated topic entirely',
      attempt: 'Another attempt',
      outcome: 'Another outcome',
      solution: 'Another solution',
      tags: ['misc'],
    });

    const results = store.searchByKeyword('automation');

    expect(results).toHaveLength(1);
    expect(results[0].scenario).toContain('automation deployment strategy');

    const storeIndex = (store as unknown as { index?: AIIndex }).index;
    storeIndex?.close();
  });
});
