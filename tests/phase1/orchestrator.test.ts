import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BlueprintOrchestrator, LLMProvider, TestRunner, TestResult } from '../../src/phase1/orchestrator';

describe('Blueprint Orchestrator', () => {
  let tempDir: string;
  let docsDir: string;
  let logsDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-test-'));
    docsDir = path.join(tempDir, 'docs');
    logsDir = path.join(tempDir, 'docs', 'logs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createMockLLM(response: string): LLMProvider {
    return { call: jest.fn().mockResolvedValue(response) };
  }

  function createMockTestRunner(passed: boolean): TestRunner {
    return {
      run: jest.fn().mockResolvedValue({
        passed,
        output: passed ? 'All tests passed' : 'Tests failed',
        duration_ms: 100,
      } as TestResult),
    };
  }

  test('reads active task from ACTIVE_TASK.md', () => {
    fs.writeFileSync(path.join(docsDir, 'ACTIVE_TASK.md'), 'Fix the login bug');
    const orch = new BlueprintOrchestrator({
      docsDir,
      logsDir,
      maxRetries: 1,
      contextSaturationThreshold: 10000,
      llmProvider: createMockLLM('fix'),
      testRunner: createMockTestRunner(true),
    });
    expect(orch.readActiveTask()).toBe('Fix the login bug');
  });

  test('returns null when no active task file', () => {
    const orch = new BlueprintOrchestrator({
      docsDir: path.join(tempDir, 'nonexistent'),
      logsDir,
      maxRetries: 1,
      contextSaturationThreshold: 10000,
      llmProvider: createMockLLM(''),
      testRunner: createMockTestRunner(true),
    });
    expect(orch.readActiveTask()).toBeNull();
  });

  test('throws when no active task exists', async () => {
    const orch = new BlueprintOrchestrator({
      docsDir: path.join(tempDir, 'nonexistent'),
      logsDir,
      maxRetries: 1,
      contextSaturationThreshold: 10000,
      llmProvider: createMockLLM(''),
      testRunner: createMockTestRunner(true),
    });
    await expect(orch.executeTask()).rejects.toThrow('No active task');
  });

  test('executes task successfully on first attempt', async () => {
    fs.writeFileSync(path.join(docsDir, 'ACTIVE_TASK.md'), 'Build feature X');
    const llm = createMockLLM('Here is the code for feature X');
    const orch = new BlueprintOrchestrator({
      docsDir,
      logsDir,
      maxRetries: 3,
      contextSaturationThreshold: 10000,
      llmProvider: llm,
      testRunner: createMockTestRunner(true),
    });

    const logs = await orch.executeTask();
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('success');
    expect(logs[0].attempt).toBe(1);
    expect(llm.call).toHaveBeenCalledTimes(1);
  });

  test('retries on test failure (Ralph Wiggum pattern)', async () => {
    fs.writeFileSync(path.join(docsDir, 'ACTIVE_TASK.md'), 'Fix bug');
    let callCount = 0;
    const testRunner: TestRunner = {
      run: jest.fn().mockImplementation(async () => {
        callCount++;
        return {
          passed: callCount >= 3,
          output: callCount >= 3 ? 'Passed' : 'Failed',
          duration_ms: 50,
        };
      }),
    };

    const orch = new BlueprintOrchestrator({
      docsDir,
      logsDir,
      maxRetries: 5,
      contextSaturationThreshold: 10000,
      llmProvider: createMockLLM('attempt fix'),
      testRunner,
    });

    const logs = await orch.executeTask();
    expect(logs.length).toBeGreaterThanOrEqual(3);
    expect(logs[logs.length - 1].status).toBe('success');
  });

  test('restarts on context saturation', async () => {
    fs.writeFileSync(path.join(docsDir, 'ACTIVE_TASK.md'), 'Task');
    const orch = new BlueprintOrchestrator({
      docsDir,
      logsDir,
      maxRetries: 2,
      contextSaturationThreshold: 10, // Very low threshold
      llmProvider: createMockLLM('A very long response that will exceed the tiny threshold'),
      testRunner: createMockTestRunner(true),
    });

    const logs = await orch.executeTask();
    expect(logs.some(l => l.status === 'restarted')).toBe(true);
  });

  test('writes execution logs to disk', async () => {
    fs.writeFileSync(path.join(docsDir, 'ACTIVE_TASK.md'), 'Log test');
    const orch = new BlueprintOrchestrator({
      docsDir,
      logsDir,
      maxRetries: 1,
      contextSaturationThreshold: 10000,
      llmProvider: createMockLLM('done'),
      testRunner: createMockTestRunner(true),
    });

    await orch.executeTask();
    const logFiles = fs.readdirSync(logsDir).filter(f => f.endsWith('.json'));
    expect(logFiles.length).toBeGreaterThan(0);
  });
});
