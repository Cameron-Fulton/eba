/**
 * Phase 4: Arena Loop Entrypoint
 * Runs the ArenaLoop optimization engine with ParallelNegativeKnowledge.
 *
 * Usage:
 *   npx ts-node src/run-arena.ts
 *
 * Environment variables:
 *   ARENA_OBJECTIVE    — name of the objective being optimized (default: "test_pass_rate")
 *   ARENA_MAX_ITER     — max iterations (default: 10)
 *   ARENA_THRESHOLD    — minimum improvement to continue (default: 0.01)
 *   SOLUTIONS_DIR      — path to negative knowledge solutions directory (default: docs/solutions)
 */

import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { ArenaLoop, ArenaState } from './phase4/arena-loop';
import { ParallelNegativeKnowledge } from './phase4/parallel-negative-knowledge';
import { NegativeKnowledgeStore } from './phase1/negative-knowledge';
import { ShellTestRunner } from './utils/shell-test-runner';

const ROOT_DIR = path.resolve(__dirname, '..');
const rawSolutionsDir = process.env.SOLUTIONS_DIR ?? 'docs/solutions';
const SOLUTIONS_DIR = path.resolve(ROOT_DIR, rawSolutionsDir);
if (!SOLUTIONS_DIR.startsWith(ROOT_DIR + path.sep) && SOLUTIONS_DIR !== ROOT_DIR) {
  throw new Error(`SOLUTIONS_DIR must be inside the project root. Got: ${SOLUTIONS_DIR}`);
}

const OBJECTIVE_NAME = process.env.ARENA_OBJECTIVE ?? 'test_pass_rate';
const TEST_COMMAND = 'npm test';
const MAX_ITERATIONS_RAW = parseInt(process.env.ARENA_MAX_ITER ?? '10', 10);
const THRESHOLD_RAW = parseFloat(process.env.ARENA_THRESHOLD ?? '0.01');

if (Number.isNaN(MAX_ITERATIONS_RAW)) {
  throw new Error(`ARENA_MAX_ITER is not a valid integer: "${process.env.ARENA_MAX_ITER}"`);
}
if (Number.isNaN(THRESHOLD_RAW)) {
  throw new Error(`ARENA_THRESHOLD is not a valid number: "${process.env.ARENA_THRESHOLD}"`);
}

const MAX_ITERATIONS = MAX_ITERATIONS_RAW;
const THRESHOLD = THRESHOLD_RAW;

async function main() {
  console.log('\n🏟️  EBA Arena Loop — Phase 4\n');
  console.log(`   Objective:      ${OBJECTIVE_NAME}`);
  console.log(`   Max iterations: ${MAX_ITERATIONS}`);
  console.log(`   Threshold:      ${THRESHOLD}\n`);

  // Bootstrap NegativeKnowledge + PNK
  const nkStore = new NegativeKnowledgeStore(SOLUTIONS_DIR);
  nkStore.loadFromDisk();
  console.log(`📚 Loaded ${nkStore.getAll().length} negative knowledge entries`);

  const pnk = new ParallelNegativeKnowledge(nkStore);

  // Real objective: run tests and score from actual results.
  // Returns 1.0 on full pass. On failure, attempts to parse Jest pass rate
  // from output using "X passed, Y total"; falls back to 0.0.
  const objectiveFn = async (_state: ArenaState): Promise<number> => {
    const testRunner = new ShellTestRunner({
      command: TEST_COMMAND,
      cwd: ROOT_DIR,
      timeoutMs: 120_000,
    });

    const result = await testRunner.run();
    if (result.passed) {
      return 1.0;
    }

    const passRateMatch = result.output.match(/(\d+)\s+passed,\s+(\d+)\s+total/i);
    if (!passRateMatch) {
      return 0.0;
    }

    const passedCount = parseInt(passRateMatch[1], 10);
    const totalCount = parseInt(passRateMatch[2], 10);
    if (Number.isNaN(passedCount) || Number.isNaN(totalCount) || totalCount <= 0) {
      return 0.0;
    }

    return passedCount / totalCount;
  };

  // Optimizer: check PNK for avoided approaches, log them, suggest next parameters
  const optimizer = async (state: ArenaState) => {
    const avoided = await pnk.getAvoidedApproaches(OBJECTIVE_NAME);

    const strategy = avoided.length > 0
      ? `skip-known-failures (avoided: ${avoided.slice(0, 3).join(', ')})`
      : `explore (iteration ${state.iteration})`;

    // Tune max_retries based on metric — fewer failures → fewer retries needed
    const maxRetries = state.current_metric > 0.8 ? 1 : state.current_metric > 0.5 ? 2 : 3;

    return {
      parameters: { max_retries: maxRetries, iteration: state.iteration },
      strategy,
    };
  };

  const arena = new ArenaLoop(
    {
      objective_name: OBJECTIVE_NAME,
      objective_fn: objectiveFn,
      max_iterations: MAX_ITERATIONS,
      improvement_threshold: THRESHOLD,
      optimizer,
    },
    { max_retries: 3 }
  );

  console.log('\n▶  Starting arena loop...\n');

  const finalState = await arena.run();

  // Print iteration history
  for (const iter of finalState.history) {
    const arrow = iter.improvement >= 0 ? '↑' : '↓';
    console.log(
      `  Iter ${String(iter.iteration).padStart(2)} ${arrow} metric=${iter.metric_value.toFixed(4)}` +
      `  improvement=${iter.improvement.toFixed(4)}  [${iter.notes.split('.')[0]}]`
    );
  }

  console.log('\n✅ Arena loop complete');
  console.log(`   Iterations run:  ${finalState.history.length}`);
  console.log(`   Best metric:     ${finalState.best_metric.toFixed(4)}`);
  console.log(`   Final params:    ${JSON.stringify(finalState.parameters)}\n`);

  // Record this run to negative knowledge if metric is low
  if (finalState.best_metric < 0.5) {
    try {
      await pnk.recordAttempt({
        thread_id: 'arena-main',
        task: OBJECTIVE_NAME,
        approach: `ArenaLoop/${MAX_ITERATIONS}-iterations`,
        avoided_approaches: await pnk.getAvoidedApproaches(OBJECTIVE_NAME),
        result: 'failure',
        timestamp: new Date().toISOString(),
      });
      console.log('📝 Low-metric run recorded to negative knowledge store');
    } catch (recordErr) {
      console.error('⚠️ Failed to record low-metric run to negative knowledge:', recordErr);
    }
  }
}

main().catch((err) => {
  console.error('\n❌ Arena error:', err);
  process.exit(1);
});
