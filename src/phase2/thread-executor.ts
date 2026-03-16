/**
 * Phase 2: Thread Executor Adapter
 * Bridges BlueprintOrchestrator single-attempt execution into the
 * ThreadExecutor signature consumed by ThreadManager.
 *
 * Each dispatch = one isolated LLM call + one test run.
 * The orchestrator's retry loop is replaced by ThreadManager's dispatch loop.
 */

import { LLMProvider, TestRunner } from '../phase1/orchestrator';
import { ThreadExecutor } from './thread-manager';

export interface ThreadExecutorConfig {
  llmProvider: LLMProvider;
  testRunner: TestRunner;
  /** Previous test output to include in prompt for retry context (optional) */
  previousFailureOutput?: string;
  /** Attempt number for prompt context (default: 1) */
  attemptNumber?: number;
  /** Context saturation limit in tokens (default: 50_000) */
  contextSaturationThreshold?: number;
}

/**
 * Builds a single-attempt prompt identical to BlueprintOrchestrator.buildPrompt().
 */
export function buildAttemptPrompt(
  task: string,
  attempt: number,
  previousFailureOutput?: string
): string {
  const parts = [`Task: ${task}`];
  if (attempt > 1) {
    parts.push('');
    parts.push(`This is attempt ${attempt}. The previous attempt failed with this test output:`);
    parts.push(previousFailureOutput ?? 'No previous test output available.');
    parts.push('');
    parts.push('Analyze the failure above and try a different approach.');
  }
  return parts.join('\n');
}

/**
 * Creates a ThreadExecutor that performs ONE LLM call + ONE test run.
 * Designed to be passed to ThreadManager, which handles the retry/dispatch loop.
 */
export function createOrchestratorExecutor(config: ThreadExecutorConfig): ThreadExecutor {
  return async (task: string, _tools: string[]) => {
    const attempt = config.attemptNumber ?? 1;
    const threshold = config.contextSaturationThreshold ?? 50_000;

    const prompt = buildAttemptPrompt(task, attempt, config.previousFailureOutput);
    const promptTokens = Math.ceil(prompt.length / 4);

    // LLM call
    let llmResponse: string;
    try {
      llmResponse = await config.llmProvider.call(prompt);
    } catch (err) {
      return {
        result: '',
        artifacts: [],
        errors: [`LLM error: ${err instanceof Error ? err.message : String(err)}`],
      };
    }

    const totalTokens = promptTokens + Math.ceil(llmResponse.length / 4);

    // Context saturation check
    if (totalTokens > threshold) {
      return {
        result: llmResponse,
        artifacts: [],
        errors: [`Context saturated: ${totalTokens} tokens exceeds threshold ${threshold}`],
      };
    }

    // Run deterministic tests
    let testResult: { passed: boolean; output: string; duration_ms: number };
    try {
      testResult = await config.testRunner.run();
    } catch (err) {
      return {
        result: llmResponse,
        artifacts: [],
        errors: [`Test runner error: ${err instanceof Error ? err.message : String(err)}`],
      };
    }

    if (testResult.passed) {
      return {
        result: llmResponse,
        artifacts: ['tests_passed'],
        errors: [],
      };
    }

    return {
      result: llmResponse,
      artifacts: [],
      errors: [testResult.output || 'Tests failed with no output'],
    };
  };
}
