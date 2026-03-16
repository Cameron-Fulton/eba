/**
 * SOP Coverage benchmark runner.
 *
 * Usage:
 *   npx ts-node src/benchmark/run-benchmark.ts
 */

import { SOPEngine, createRefactoringSOP } from '../phase2/sop';
import {
  createBugFixSOP,
  createFeatureSOP,
  createCodeReviewSOP,
  createDependencyUpgradeSOP,
  createDeploymentSOP,
} from '../phase2/sop-library';
import { SOPCoverageBenchmark } from './sop-coverage';
import { STANDARD_TASK_CORPUS } from './task-corpus';

const COVERAGE_THRESHOLD = 0.5;

function main() {
  console.log('\n📏 SOP Coverage Benchmark\n');

  const sopEngine = new SOPEngine();

  // Register all currently available SOPs.
  const availableSops = [
    createRefactoringSOP(),
    createBugFixSOP(),
    createFeatureSOP(),
    createCodeReviewSOP(),
    createDependencyUpgradeSOP(),
    createDeploymentSOP(),
  ];

  for (const sop of availableSops) {
    sopEngine.register(sop);
  }

  const benchmark = new SOPCoverageBenchmark(STANDARD_TASK_CORPUS, sopEngine);

  let result;
  try {
    result = benchmark.run();
  } catch (err) {
    console.error('Benchmark failed:', err);
    process.exit(2);
  }

  console.log('Registered SOPs:');
  for (const sop of sopEngine.getRegisteredSOPs()) {
    console.log(`  - ${sop.name} (${sop.id})`);
  }

  console.log('\nResults:');
  console.log(`  Score:   ${result.score.toFixed(3)} (${result.covered}/${result.total})`);
  console.log(`  Covered: ${result.covered}`);
  console.log(`  Total:   ${result.total}`);

  console.log('\nTask breakdown:');
  result.breakdown.forEach((item, index) => {
    const marker = item.matched_sop ? '✅' : '❌';
    const matched = item.matched_sop ?? 'none';
    console.log(`\n${marker} Task ${index + 1}: ${item.task}`);
    console.log(`   matched_sop: ${matched}`);
    console.log(`   confidence:  ${item.confidence.toFixed(3)}`);
  });

  const uncovered = result.breakdown.filter(item => !item.matched_sop);
  if (uncovered.length > 0) {
    console.log('\nUncovered task count:', uncovered.length);
  }

  console.log('');

  if (result.score < COVERAGE_THRESHOLD) {
    console.error(`Coverage score ${result.score.toFixed(3)} is below threshold ${COVERAGE_THRESHOLD}`);
    process.exit(1);
  }

  process.exit(0);
}

main();
