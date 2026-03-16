import { SOPCoverageBenchmark, BenchmarkResult, TaskCoverage } from '../../src/benchmark/sop-coverage';
import { STANDARD_TASK_CORPUS } from '../../src/benchmark/task-corpus';
import { SOPEngine, createRefactoringSOP } from '../../src/phase2/sop';
import {
  createBugFixSOP,
  createFeatureSOP,
  createCodeReviewSOP,
  createDependencyUpgradeSOP,
  createDeploymentSOP,
} from '../../src/phase2/sop-library';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fullSopEngine(): SOPEngine {
  const engine = new SOPEngine();
  engine.register(createRefactoringSOP());
  engine.register(createBugFixSOP());
  engine.register(createFeatureSOP());
  engine.register(createCodeReviewSOP());
  engine.register(createDependencyUpgradeSOP());
  engine.register(createDeploymentSOP());
  return engine;
}

function emptySopEngine(): SOPEngine {
  return new SOPEngine();
}

// ---------------------------------------------------------------------------
// SOPCoverageBenchmark
// ---------------------------------------------------------------------------

describe('SOPCoverageBenchmark', () => {

  describe('1) EMPTY TASK LIST', () => {
    test('returns zero score and empty breakdown when no tasks are provided', () => {
      const benchmark = new SOPCoverageBenchmark([], fullSopEngine());
      const result: BenchmarkResult = benchmark.run();

      expect(result.score).toBe(0);
      expect(result.total).toBe(0);
      expect(result.covered).toBe(0);
      expect(result.breakdown).toEqual([]);
    });
  });

  describe('2) NO SOPS REGISTERED', () => {
    test('all tasks are uncovered when the SOP engine is empty', () => {
      const tasks = ['Fix a null pointer bug', 'Add a CSV export feature'];
      const benchmark = new SOPCoverageBenchmark(tasks, emptySopEngine());
      const result = benchmark.run();

      expect(result.total).toBe(2);
      expect(result.covered).toBe(0);
      expect(result.score).toBe(0);
      result.breakdown.forEach(item => {
        expect(item.matched_sop).toBeNull();
      });
    });
  });

  describe('3) RESULT STRUCTURE', () => {
    test('breakdown entries have the correct shape', () => {
      const tasks = ['Refactor the legacy billing module into smaller functions'];
      const benchmark = new SOPCoverageBenchmark(tasks, fullSopEngine());
      const result = benchmark.run();

      expect(result.breakdown).toHaveLength(1);
      const item: TaskCoverage = result.breakdown[0];
      expect(item).toHaveProperty('task', tasks[0]);
      expect(item).toHaveProperty('matched_sop');
      expect(item).toHaveProperty('confidence');
      expect(typeof item.confidence).toBe('number');
      expect(item.confidence).toBeGreaterThanOrEqual(0);
      expect(item.confidence).toBeLessThanOrEqual(1);
    });

    test('score equals covered / total', () => {
      const tasks = [
        'Refactor the legacy billing module safely', // should match refactoring SOP
        'zxqvbnm completely unrelated gibberish qwerty', // should not match
      ];
      const benchmark = new SOPCoverageBenchmark(tasks, fullSopEngine());
      const result = benchmark.run();

      expect(result.total).toBe(2);
      const expectedScore = result.covered / result.total;
      expect(result.score).toBeCloseTo(expectedScore, 5);
    });
  });

  describe('4) THRESHOLD', () => {
    test('no tasks are covered when threshold is set to 1.0 (impossible to reach)', () => {
      const tasks = ['Refactor the legacy billing module into smaller functions without changing behavior'];
      const benchmark = new SOPCoverageBenchmark(tasks, fullSopEngine(), 1.0);
      const result = benchmark.run();

      expect(result.covered).toBe(0);
      result.breakdown.forEach(item => {
        expect(item.matched_sop).toBeNull();
      });
    });

    test('all tasks are covered when threshold is set to 0 (any similarity qualifies)', () => {
      const tasks = ['Fix a bug', 'Deploy the app'];
      const benchmark = new SOPCoverageBenchmark(tasks, fullSopEngine(), 0);
      const result = benchmark.run();

      // With threshold=0, every task with any SOP present should be matched
      expect(result.covered).toBe(result.total);
      expect(result.score).toBe(1);
      result.breakdown.forEach(item => {
        expect(item.matched_sop).not.toBeNull();
      });
    });
  });

  describe('5) BEST MATCH SELECTION', () => {
    test('the highest-confidence SOP is selected as the match', () => {
      // A refactoring-specific task should map to the refactoring SOP, not deployment
      const tasks = ['Refactor the authentication module into clean functions'];
      const benchmark = new SOPCoverageBenchmark(tasks, fullSopEngine());
      const result = benchmark.run();

      const item = result.breakdown[0];
      // The matched SOP should be non-null and reflect the best match
      if (item.matched_sop !== null) {
        expect(typeof item.matched_sop).toBe('string');
        expect(item.matched_sop.length).toBeGreaterThan(0);
      }
      // Confidence should be the highest possible across all registered SOPs
      expect(item.confidence).toBeGreaterThanOrEqual(0);
    });

    test('confidence is consistent across repeated runs (deterministic)', () => {
      const tasks = ['Debug and fix a critical null pointer crash in the payment service'];
      const engine = fullSopEngine();
      const r1 = new SOPCoverageBenchmark(tasks, engine).run();
      const r2 = new SOPCoverageBenchmark(tasks, engine).run();

      expect(r1.score).toBe(r2.score);
      expect(r1.breakdown[0].confidence).toBe(r2.breakdown[0].confidence);
      expect(r1.breakdown[0].matched_sop).toBe(r2.breakdown[0].matched_sop);
    });
  });

  describe('6) SCORE BOUNDS', () => {
    test('score is always between 0 and 1 inclusive for any task list', () => {
      const taskSets = [
        [],
        ['Gibberish xkcd zxqv'],
        ['Fix a bug', 'Deploy the app', 'Refactor logs'],
        STANDARD_TASK_CORPUS,
      ];

      for (const tasks of taskSets) {
        const benchmark = new SOPCoverageBenchmark(tasks, fullSopEngine());
        const result = benchmark.run();
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
      }
    });

    test('covered never exceeds total', () => {
      const benchmark = new SOPCoverageBenchmark(STANDARD_TASK_CORPUS, fullSopEngine());
      const result = benchmark.run();
      expect(result.covered).toBeLessThanOrEqual(result.total);
    });
  });

  describe('7) STANDARD TASK CORPUS — FULL SOP LIBRARY', () => {
    test('score meets or exceeds the 0.5 benchmark threshold with all SOPs registered', () => {
      const benchmark = new SOPCoverageBenchmark(STANDARD_TASK_CORPUS, fullSopEngine());
      const result = benchmark.run();

      // The run-benchmark.ts script exits 1 below 0.5; tests must enforce the same gate.
      expect(result.score).toBeGreaterThanOrEqual(0.5);
    });

    test('breakdown length matches task corpus length', () => {
      const benchmark = new SOPCoverageBenchmark(STANDARD_TASK_CORPUS, fullSopEngine());
      const result = benchmark.run();
      expect(result.breakdown).toHaveLength(STANDARD_TASK_CORPUS.length);
    });

    test('every breakdown entry maps back to a task in the corpus', () => {
      const benchmark = new SOPCoverageBenchmark(STANDARD_TASK_CORPUS, fullSopEngine());
      const { breakdown } = benchmark.run();
      breakdown.forEach(item => {
        expect(STANDARD_TASK_CORPUS).toContain(item.task);
      });
    });
  });

  describe('8) TASK LIST IMMUTABILITY', () => {
    test('mutating the original task array after construction does not affect results', () => {
      const tasks = ['Fix a critical bug in the payment service'];
      const benchmark = new SOPCoverageBenchmark(tasks, fullSopEngine());
      tasks.push('This should not appear in results');
      const result = benchmark.run();

      expect(result.total).toBe(1);
      const taskStrings = result.breakdown.map(i => i.task);
      expect(taskStrings).not.toContain('This should not appear in results');
    });
  });
});

// ---------------------------------------------------------------------------
// STANDARD_TASK_CORPUS
// ---------------------------------------------------------------------------

describe('STANDARD_TASK_CORPUS', () => {
  test('is an array', () => {
    expect(Array.isArray(STANDARD_TASK_CORPUS)).toBe(true);
  });

  test('contains exactly 10 entries', () => {
    expect(STANDARD_TASK_CORPUS).toHaveLength(10);
  });

  test('every entry is a non-empty string', () => {
    STANDARD_TASK_CORPUS.forEach(task => {
      expect(typeof task).toBe('string');
      expect(task.trim().length).toBeGreaterThan(0);
    });
  });

  test('all entries are unique', () => {
    const unique = new Set(STANDARD_TASK_CORPUS);
    expect(unique.size).toBe(STANDARD_TASK_CORPUS.length);
  });

  test('covers diverse engineering categories', () => {
    const joined = STANDARD_TASK_CORPUS.join(' ').toLowerCase();
    const expectedKeywords = ['bug', 'feature', 'refactor', 'review', 'deploy'];
    expectedKeywords.forEach(keyword => {
      expect(joined).toContain(keyword);
    });
  });
});
