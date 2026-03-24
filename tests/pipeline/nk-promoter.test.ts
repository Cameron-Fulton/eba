import { NKPromoter, NKPromoterConfig } from '../../src/pipeline/nk-promoter';
import { NegativeKnowledgeEntry } from '../../src/phase1/negative-knowledge';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function makeEntry(overrides: Partial<NegativeKnowledgeEntry> = {}): NegativeKnowledgeEntry {
  return {
    id: 'nk_test_001',
    scenario: 'Test scenario',
    attempt: 'Test attempt',
    outcome: 'Test outcome',
    solution: 'Test solution',
    tags: ['auto-recorded', 'refactoring'],
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makePromoter(overrides: Partial<NKPromoterConfig> = {}): NKPromoter {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nk-promoter-'));
  return new NKPromoter({
    intakeDir: tempDir,
    projectName: 'test-project',
    projectRoot: '/home/user/projects/test-project',
    ...overrides,
  });
}

describe('NKPromoter', () => {
  describe('score()', () => {
    test('high score for entry with framework tags and clean solution', () => {
      const promoter = makePromoter();
      const entry = makeEntry({
        tags: ['jest', 'typescript', 'auto-recorded', 'refactoring'],
        scenario: 'Jest test fails when importing ESM module',
        solution: 'Add transformIgnorePatterns to jest.config',
      });
      const score = promoter.score(entry);
      expect(score).toBeGreaterThanOrEqual(50);
    });

    test('low score for entry with project-specific paths', () => {
      const promoter = makePromoter();
      const entry = makeEntry({
        tags: ['auto-recorded', 'refactoring'],
        scenario: 'Error in D:\\projects\\myapp\\src\\controllers\\userController.ts',
        solution: 'Fixed the userController.ts file at line 42',
      });
      const score = promoter.score(entry);
      expect(score).toBeLessThan(50);
    });

    test('awards points for framework config file references', () => {
      const promoter = makePromoter();
      const entry = makeEntry({
        tags: ['auto-recorded', 'refactoring'],
        scenario: 'Build fails after editing tsconfig settings',
        solution: 'Set moduleResolution to bundler in tsconfig',
      });
      const scoreWith = promoter.score(entry);
      const entryWithout = makeEntry({
        tags: ['auto-recorded', 'refactoring'],
        scenario: 'Build fails after editing config',
        solution: 'Set moduleResolution to bundler',
      });
      const scoreWithout = promoter.score(entryWithout);
      expect(scoreWith).toBeGreaterThan(scoreWithout);
    });

    test('clamps score to 0-100 range', () => {
      const promoter = makePromoter();
      const highEntry = makeEntry({
        tags: ['jest', 'typescript', 'react', 'auto-recorded'],
        scenario: 'Jest test build fails when importing module',
        solution: 'Add config to jest.config.ts',
      });
      expect(promoter.score(highEntry)).toBeLessThanOrEqual(100);

      const lowEntry = makeEntry({
        tags: ['auto-recorded', 'refactoring'],
        scenario: 'Error in D:\\projects\\myapp\\src\\userController.ts at line 42',
        solution: 'Fixed /home/user/projects/myapp/src/userController.ts',
      });
      expect(promoter.score(lowEntry)).toBeGreaterThanOrEqual(0);
    });

    test('penalizes entries with no framework tags', () => {
      const promoter = makePromoter();
      const entry = makeEntry({
        tags: ['auto-recorded', 'refactoring'],
        scenario: 'Something broke',
        solution: 'Fixed it',
      });
      const score = promoter.score(entry);
      expect(score).toBeLessThan(50);
    });
  });

  describe('generalize()', () => {
    test('strips project-specific absolute paths', () => {
      const promoter = makePromoter({ projectRoot: 'D:\\projects\\myapp' });
      const entry = makeEntry({
        scenario: 'Error in D:\\projects\\myapp\\src\\auth\\token.ts',
        solution: 'Fixed D:\\projects\\myapp\\src\\auth\\token.ts',
      });
      const gen = promoter.generalize(entry);
      expect(gen.scenario).not.toContain('D:\\projects\\myapp');
      expect(gen.solution).not.toContain('D:\\projects\\myapp');
    });

    test('strips unix absolute paths', () => {
      const promoter = makePromoter({ projectRoot: '/home/user/myapp' });
      const entry = makeEntry({
        scenario: 'Error in /home/user/myapp/src/auth/token.ts',
      });
      const gen = promoter.generalize(entry);
      expect(gen.scenario).not.toContain('/home/user/myapp');
    });

    test('preserves framework-convention filenames', () => {
      const promoter = makePromoter();
      const entry = makeEntry({
        scenario: 'Error in tsconfig.json when setting moduleResolution',
        solution: 'Edit jest.config.ts to add transform',
      });
      const gen = promoter.generalize(entry);
      expect(gen.scenario).toContain('tsconfig.json');
      expect(gen.solution).toContain('jest.config.ts');
    });

    test('strips camelCase specific filenames but keeps directory context', () => {
      const promoter = makePromoter();
      const entry = makeEntry({
        scenario: 'src/controllers/userController.ts throws error',
      });
      const gen = promoter.generalize(entry);
      expect(gen.scenario).not.toContain('userController.ts');
      expect(gen.scenario).toContain('controllers');
    });

    test('strips standalone camelCase filename without path prefix', () => {
      const promoter = makePromoter();
      const entry = makeEntry({
        scenario: 'userController.ts throws TypeError',
      });
      const gen = promoter.generalize(entry);
      expect(gen.scenario).not.toContain('userController.ts');
      expect(gen.scenario).toContain('throws TypeError');
    });

    test('strips stack traces', () => {
      const promoter = makePromoter();
      const entry = makeEntry({
        outcome: 'Error: foo\n    at Object.<anonymous> (/test.js:5:1)\n    at Module._compile',
      });
      const gen = promoter.generalize(entry);
      expect(gen.outcome).toContain('Error: foo');
      expect(gen.outcome).not.toContain('at Object.<anonymous>');
      expect(gen.outcome).not.toContain('Module._compile');
    });

    test('adds provenance tags', () => {
      const promoter = makePromoter({ projectName: 'my-app' });
      const entry = makeEntry({ tags: ['jest', 'auto-recorded'] });
      const gen = promoter.generalize(entry);
      expect(gen.tags).toContain('promoted');
      expect(gen.tags).toContain('unvalidated');
      expect(gen.tags).toContain('votes:0');
      expect(gen.tags.some(t => t.startsWith('source:'))).toBe(true);
      expect(gen.tags.some(t => t.startsWith('promoted:'))).toBe(true);
      // auto-recorded should be filtered out
      expect(gen.tags).not.toContain('auto-recorded');
    });

    test('generates crossProjectReason from framework tag', () => {
      const promoter = makePromoter();
      const entry = makeEntry({
        tags: ['jest', 'auto-recorded'],
        scenario: 'Jest test fails with ESM import error',
      });
      const gen = promoter.generalize(entry);
      expect(gen.crossProjectReason).toContain('jest');
    });

    test('falls back to generic crossProjectReason when no framework tag', () => {
      const promoter = makePromoter();
      const entry = makeEntry({
        tags: ['auto-recorded', 'refactoring'],
        scenario: 'Something broke',
      });
      const gen = promoter.generalize(entry);
      expect(gen.crossProjectReason).toContain('Common development pattern');
    });
  });
});
