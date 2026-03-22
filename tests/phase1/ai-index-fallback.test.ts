import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { NegativeKnowledgeEntry } from '../../src/phase1/negative-knowledge';

describe('AIIndex fallback (in-memory)', () => {
  let tempDir: string;
  let dbPath: string;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-index-fallback-test-'));
    dbPath = path.join(tempDir, '.ai_index', 'index.db');
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {
      // Silence expected fallback warning in tests
    });
  });

  afterEach(() => {
    warnSpy.mockRestore();
    jest.dontMock('better-sqlite3');
    jest.resetModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createFallbackIndex() {
    jest.resetModules();
    jest.doMock('better-sqlite3', () => {
      throw new Error('better-sqlite3 native module failed to load');
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AIIndex } = require('../../src/phase1/ai-index') as typeof import('../../src/phase1/ai-index');
    return new AIIndex(dbPath);
  }

  test('index() + search() works in memory mode', () => {
    const index = createFallbackIndex();
    const entry: NegativeKnowledgeEntry = {
      id: 'mem_1',
      scenario: 'Fallback scenario term',
      attempt: 'Fallback attempt text',
      outcome: 'Fallback outcome text',
      solution: 'Fallback solution text',
      tags: ['fallbacktag', 'memory'],
      timestamp: new Date().toISOString(),
    };

    index.index(entry);

    expect(index.search('scenario')).toHaveLength(1);
    expect(index.search('attempt')).toHaveLength(1);
    expect(index.search('outcome')).toHaveLength(1);
    expect(index.search('solution')).toHaveLength(1);
    expect(index.search('fallbacktag')).toHaveLength(1);
  });

  test('remove() works in memory mode', () => {
    const index = createFallbackIndex();
    const entry: NegativeKnowledgeEntry = {
      id: 'mem_2',
      scenario: 'Remove in fallback mode',
      attempt: 'Attempt',
      outcome: 'Outcome',
      solution: 'Solution',
      tags: ['removefallback'],
      timestamp: new Date().toISOString(),
    };

    index.index(entry);
    expect(index.search('removefallback')).toHaveLength(1);

    index.remove(entry.id);
    expect(index.search('removefallback')).toEqual([]);
  });

  test('close() is safe in memory mode', () => {
    const index = createFallbackIndex();

    expect(() => index.close()).not.toThrow();
    expect(() => index.close()).not.toThrow();
  });

  test('search() returns empty for non-matching terms', () => {
    const index = createFallbackIndex();
    index.index({
      id: 'mem_3',
      scenario: 'Known fallback scenario',
      attempt: 'Known fallback attempt',
      outcome: 'Known fallback outcome',
      solution: 'Known fallback solution',
      tags: ['knownfallback'],
      timestamp: new Date().toISOString(),
    });

    expect(index.search('definitely-not-present')).toEqual([]);
  });
});
