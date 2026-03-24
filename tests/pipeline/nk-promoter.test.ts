import { NKPromoter, NKPromoterConfig, GeneralizedEntry } from '../../src/pipeline/nk-promoter';
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
      expect(gen.tags).not.toContain('votes:0');
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

    it('generalize() does not include votes:0 in tags', () => {
      const promoter = makePromoter({ projectName: 'test' });
      const entry = makeEntry({ tags: ['jest', 'auto-recorded'] });
      const gen = promoter.generalize(entry);
      expect(gen.tags).not.toContain('votes:0');
      expect(gen.tags).toContain('promoted');
      expect(gen.tags).toContain('unvalidated');
    });

    it('generalize() initializes vote_metrics with _default context', () => {
      const promoter = makePromoter({ projectName: 'test' });
      const entry = makeEntry({ tags: ['jest', 'auto-recorded'] });
      const gen = promoter.generalize(entry);
      expect(gen.vote_metrics).toEqual({
        contexts: { _default: { successes: 0, total_attempts: 0 } },
      });
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

  describe('promote()', () => {
    let tempIntakeDir: string;
    let tempProjectDir: string;

    beforeEach(() => {
      tempIntakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nk-intake-'));
      tempProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nk-project-'));
    });

    afterEach(() => {
      fs.rmSync(tempIntakeDir, { recursive: true, force: true });
      fs.rmSync(tempProjectDir, { recursive: true, force: true });
    });

    test('writes intake file for high-scoring entry', () => {
      const promoter = new NKPromoter({
        intakeDir: tempIntakeDir,
        projectName: 'test-app',
        projectRoot: tempProjectDir,
      });
      const entry = makeEntry({
        tags: ['jest', 'typescript', 'auto-recorded'],
        scenario: 'Jest test fails with ESM import error',
        solution: 'Add transformIgnorePatterns to jest.config',
      });
      const count = promoter.promote([entry]);
      expect(count).toBe(1);
      const files = fs.readdirSync(tempIntakeDir).filter(f => f.endsWith('.md'));
      expect(files).toHaveLength(1);
      expect(files[0]).toContain('eba-nk-test-app');
      const content = fs.readFileSync(path.join(tempIntakeDir, files[0]), 'utf-8');
      expect(content).toContain('validated: false');
      expect(content).toContain('votes: 0');
    });

    test('skips low-scoring entries', () => {
      const promoter = new NKPromoter({
        intakeDir: tempIntakeDir,
        projectName: 'test-app',
        projectRoot: tempProjectDir,
      });
      const entry = makeEntry({
        tags: ['auto-recorded', 'refactoring'],
        scenario: 'Error in D:\\projects\\myapp\\src\\userController.ts',
        solution: 'Fixed /home/user/projects/myapp/src/userController.ts',
      });
      const count = promoter.promote([entry]);
      expect(count).toBe(0);
    });

    test('deduplicates using promoted_ids.json ledger', () => {
      const promoter = new NKPromoter({
        intakeDir: tempIntakeDir,
        projectName: 'test-app',
        projectRoot: tempProjectDir,
      });
      const entry = makeEntry({
        id: 'nk_dedup_test',
        tags: ['jest', 'typescript', 'auto-recorded'],
        scenario: 'Jest test fails with ESM import error',
        solution: 'Add transformIgnorePatterns to jest.config',
      });
      expect(promoter.promote([entry])).toBe(1);
      expect(promoter.promote([entry])).toBe(0);
      const ledgerPath = path.join(tempProjectDir, '.eba', 'promoted_ids.json');
      expect(fs.existsSync(ledgerPath)).toBe(true);
      const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
      expect(ledger).toContain('nk_dedup_test');
    });

    test('handles missing intake directory gracefully', () => {
      const promoter = new NKPromoter({
        intakeDir: '/nonexistent/path/intake',
        projectName: 'test-app',
        projectRoot: tempProjectDir,
      });
      const entry = makeEntry({
        tags: ['jest', 'typescript', 'auto-recorded'],
        scenario: 'Jest test fails',
        solution: 'Fix jest config',
      });
      expect(promoter.promote([entry])).toBe(0);
    });

    test('end-to-end: promotes high-scoring, skips low-scoring', () => {
      const promoter = new NKPromoter({
        intakeDir: tempIntakeDir,
        projectName: 'integration-app',
        projectRoot: tempProjectDir,
      });
      const entries = [
        makeEntry({
          id: 'nk_integ_001',
          tags: ['jest', 'typescript', 'auto-recorded', 'refactoring'],
          scenario: 'Jest test fails when importing ESM module',
          solution: 'Add transformIgnorePatterns to jest.config',
        }),
        makeEntry({
          id: 'nk_integ_002',
          tags: ['auto-recorded', 'refactoring'],
          scenario: 'Error in D:\\projects\\myapp\\src\\userController.ts',
          solution: 'Fixed the file at D:\\projects\\myapp\\src\\userController.ts',
        }),
      ];
      const count = promoter.promote(entries);
      expect(count).toBe(1);
      const files = fs.readdirSync(tempIntakeDir).filter(f => f.endsWith('.md'));
      expect(files).toHaveLength(1);
      const content = fs.readFileSync(path.join(tempIntakeDir, files[0]), 'utf-8');
      expect(content).toContain('validated: false');
      expect(content).toContain('votes: 0');
      const ledger = JSON.parse(fs.readFileSync(
        path.join(tempProjectDir, '.eba', 'promoted_ids.json'), 'utf-8'
      ));
      expect(ledger).toContain('nk_integ_001');
      expect(ledger).not.toContain('nk_integ_002');
    });
  });

  describe('toIntakeMarkdown()', () => {
    test('produces valid frontmatter with validation fields', () => {
      const promoter = makePromoter({ projectName: 'my-app' });
      const gen: GeneralizedEntry = {
        scenario: 'Jest test fails with ESM error',
        attempt: 'Used jest.mock()',
        outcome: 'ESM breaks mock hoisting',
        solution: 'Add transformIgnorePatterns',
        tags: ['jest', 'promoted', 'unvalidated'],
        originalTags: ['jest', 'auto-recorded'],
        crossProjectReason: 'Common jest pattern: Jest test fails with ESM error',
        vote_metrics: { contexts: { _default: { successes: 0, total_attempts: 0 } } },
      };
      const md = promoter.toIntakeMarkdown(gen, 'my-app');
      expect(md).toContain('source: eba-nk-promotion');
      expect(md).toContain('project: my-app');
      expect(md).toContain('type: solution');
      expect(md).toContain('validated: false');
      expect(md).toContain('votes: 0');
    });

    test('includes all sections', () => {
      const promoter = makePromoter();
      const gen: GeneralizedEntry = {
        scenario: 'Test scenario',
        attempt: 'Test attempt',
        outcome: 'Test outcome',
        solution: 'Test solution',
        tags: ['promoted'],
        originalTags: ['auto-recorded'],
        crossProjectReason: 'Common pattern',
        vote_metrics: { contexts: { _default: { successes: 0, total_attempts: 0 } } },
      };
      const md = promoter.toIntakeMarkdown(gen, 'test-project');
      expect(md).toContain('## Test scenario');
      expect(md).toContain('### Failed Approach');
      expect(md).toContain('Test attempt');
      expect(md).toContain('### Why It Failed');
      expect(md).toContain('Test outcome');
      expect(md).toContain('### What Works');
      expect(md).toContain('Test solution');
      expect(md).toContain('**Why this matters beyond one project:**');
    });
  });
});
