import { LLMProvider, TestRunner } from '../../src/phase1/orchestrator';
import {
  buildAttemptPrompt,
  createOrchestratorExecutor,
} from '../../src/phase2/thread-executor';

describe('Thread Executor Adapter', () => {
  test('buildAttemptPrompt first attempt has no retry context', () => {
    const prompt = buildAttemptPrompt('Implement feature X', 1);

    expect(prompt).toBe('Task: Implement feature X');
    expect(prompt).not.toContain('This is attempt');
    expect(prompt).not.toContain('Analyze the failure above');
  });

  test('buildAttemptPrompt second attempt includes previous failure output', () => {
    const prompt = buildAttemptPrompt('Fix flaky tests', 2, 'AssertionError: expected true to be false');

    expect(prompt).toContain('Task: Fix flaky tests');
    expect(prompt).toContain('This is attempt 2. The previous attempt failed with this test output:');
    expect(prompt).toContain('AssertionError: expected true to be false');
    expect(prompt).toContain('Analyze the failure above and try a different approach.');
  });

  test('createOrchestratorExecutor success path returns tests_passed artifact and no errors', async () => {
    const llmProvider: LLMProvider = {
      call: jest.fn(async () => 'Implemented the requested change.'),
    };
    const testRunner: TestRunner = {
      run: jest.fn(async () => ({ passed: true, output: 'All tests passed', duration_ms: 42 })),
    };

    const executor = createOrchestratorExecutor({ llmProvider, testRunner });
    const result = await executor('Ship phase 2', ['file', 'bash']);

    expect(result.result).toBe('Implemented the requested change.');
    expect(result.artifacts).toEqual(['tests_passed']);
    expect(result.errors).toEqual([]);
    expect(llmProvider.call).toHaveBeenCalledTimes(1);
    expect(testRunner.run).toHaveBeenCalledTimes(1);
  });

  test('createOrchestratorExecutor test failure path returns test output in errors', async () => {
    const llmProvider: LLMProvider = {
      call: jest.fn(async () => 'Attempted fix output'),
    };
    const testRunner: TestRunner = {
      run: jest.fn(async () => ({ passed: false, output: 'TypeError: cannot read property', duration_ms: 11 })),
    };

    const executor = createOrchestratorExecutor({ llmProvider, testRunner });
    const result = await executor('Fix bug', []);

    expect(result.result).toBe('Attempted fix output');
    expect(result.artifacts).toEqual([]);
    expect(result.errors).toEqual(['TypeError: cannot read property']);
    expect(llmProvider.call).toHaveBeenCalledTimes(1);
    expect(testRunner.run).toHaveBeenCalledTimes(1);
  });

  test('createOrchestratorExecutor LLM error path returns error and empty result', async () => {
    const llmProvider: LLMProvider = {
      call: jest.fn(async () => {
        throw new Error('provider unavailable');
      }),
    };
    const testRunner: TestRunner = {
      run: jest.fn(async () => ({ passed: true, output: 'unused', duration_ms: 1 })),
    };

    const executor = createOrchestratorExecutor({ llmProvider, testRunner });
    const result = await executor('Any task', ['file_read']);

    expect(result.result).toBe('');
    expect(result.artifacts).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('LLM error: provider unavailable');
    expect(llmProvider.call).toHaveBeenCalledTimes(1);
    expect(testRunner.run).toHaveBeenCalledTimes(0);
  });

  test('createOrchestratorExecutor context saturation returns saturation error', async () => {
    const llmProvider: LLMProvider = {
      call: jest.fn(async () => 'x'.repeat(500)),
    };
    const testRunner: TestRunner = {
      run: jest.fn(async () => ({ passed: true, output: 'unused', duration_ms: 1 })),
    };

    const executor = createOrchestratorExecutor({
      llmProvider,
      testRunner,
      contextSaturationThreshold: 10,
    });

    const result = await executor('Small task', []);

    expect(result.result.length).toBe(500);
    expect(result.artifacts).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Context saturated');
    expect(testRunner.run).toHaveBeenCalledTimes(0);
  });

  test('createOrchestratorExecutor test runner error returns test runner error message', async () => {
    const llmProvider: LLMProvider = {
      call: jest.fn(async () => 'LLM produced output'),
    };
    const testRunner: TestRunner = {
      run: jest.fn(async () => {
        throw new Error('runner crashed');
      }),
    };

    const executor = createOrchestratorExecutor({ llmProvider, testRunner });
    const result = await executor('Run failing tests', ['bash']);

    expect(result.result).toBe('LLM produced output');
    expect(result.artifacts).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Test runner error: runner crashed');
    expect(llmProvider.call).toHaveBeenCalledTimes(1);
    expect(testRunner.run).toHaveBeenCalledTimes(1);
  });

  test('executor accepts tools parameter but ignores it for routing', async () => {
    const llmProvider: LLMProvider = {
      call: jest.fn(async () => 'Response independent of tools'),
    };
    const testRunner: TestRunner = {
      run: jest.fn(async () => ({ passed: true, output: 'All good', duration_ms: 2 })),
    };

    const executor = createOrchestratorExecutor({ llmProvider, testRunner });

    const withTools = await executor('Same task', ['bash', 'file_write', 'network']);
    const withoutTools = await executor('Same task', []);

    expect(withTools.result).toBe('Response independent of tools');
    expect(withoutTools.result).toBe('Response independent of tools');
    expect(withTools.artifacts).toEqual(['tests_passed']);
    expect(withoutTools.artifacts).toEqual(['tests_passed']);
    expect(withTools.errors).toEqual([]);
    expect(withoutTools.errors).toEqual([]);
    expect(llmProvider.call).toHaveBeenCalledTimes(2);
    expect(testRunner.run).toHaveBeenCalledTimes(2);
  });
});
