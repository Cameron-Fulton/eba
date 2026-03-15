/**
 * Phase 1: Basic Blueprint Orchestrator
 * Reads active task, invokes LLM (mockable), runs deterministic tests,
 * implements the Ralph Wiggum kill-and-restart pattern.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface LLMProvider {
  call(prompt: string): Promise<string>;
}

export interface TestRunner {
  run(): Promise<TestResult>;
}

export interface TestResult {
  passed: boolean;
  output: string;
  duration_ms: number;
}

export interface OrchestratorConfig {
  docsDir: string;
  logsDir: string;
  maxRetries: number;
  contextSaturationThreshold: number;
  llmProvider: LLMProvider;
  testRunner: TestRunner;
}

export interface ExecutionLog {
  timestamp: string;
  task: string;
  attempt: number;
  llm_response: string;
  test_result: TestResult;
  status: 'success' | 'failure' | 'restarted';
}

export class BlueprintOrchestrator {
  private config: OrchestratorConfig;
  private contextTokens: number = 0;
  private attempt: number = 0;

  constructor(config: OrchestratorConfig) {
    this.config = config;
  }

  readActiveTask(): string | null {
    const taskFile = path.join(this.config.docsDir, 'ACTIVE_TASK.md');
    if (!fs.existsSync(taskFile)) return null;
    return fs.readFileSync(taskFile, 'utf-8').trim();
  }

  async executeTask(): Promise<ExecutionLog[]> {
    const logs: ExecutionLog[] = [];
    const task = this.readActiveTask();
    if (!task) {
      throw new Error('No active task found in ACTIVE_TASK.md');
    }

    for (this.attempt = 1; this.attempt <= this.config.maxRetries; this.attempt++) {
      // Fresh agent each attempt (Ralph Wiggum pattern)
      this.contextTokens = 0;

      const prompt = this.buildPrompt(task, this.attempt);
      this.contextTokens += Math.ceil(prompt.length / 4);

      let llmResponse: string;
      try {
        llmResponse = await this.config.llmProvider.call(prompt);
        this.contextTokens += Math.ceil(llmResponse.length / 4);
      } catch (err) {
        const log = this.createLog(task, '', { passed: false, output: `LLM error: ${err}`, duration_ms: 0 }, 'failure');
        logs.push(log);
        continue;
      }

      // Check context saturation
      if (this.contextTokens > this.config.contextSaturationThreshold) {
        const log = this.createLog(task, llmResponse, { passed: false, output: 'Context saturated', duration_ms: 0 }, 'restarted');
        logs.push(log);
        this.writeLog(log);
        continue; // Kill and restart fresh
      }

      // Run deterministic tests
      const testResult = await this.config.testRunner.run();

      const status = testResult.passed ? 'success' : 'failure';
      const log = this.createLog(task, llmResponse, testResult, status);
      logs.push(log);
      this.writeLog(log);

      if (testResult.passed) {
        break; // Task succeeded
      }
      // Test failed — Ralph Wiggum: kill this agent, restart fresh
    }

    return logs;
  }

  private buildPrompt(task: string, attempt: number): string {
    const parts = [`Task: ${task}`];
    if (attempt > 1) {
      parts.push(`This is attempt ${attempt}. Previous attempts failed. Try a different approach.`);
    }
    return parts.join('\n');
  }

  private createLog(
    task: string,
    llmResponse: string,
    testResult: TestResult,
    status: ExecutionLog['status']
  ): ExecutionLog {
    return {
      timestamp: new Date().toISOString(),
      task,
      attempt: this.attempt,
      llm_response: llmResponse,
      test_result: testResult,
      status,
    };
  }

  private writeLog(log: ExecutionLog): void {
    if (!fs.existsSync(this.config.logsDir)) {
      fs.mkdirSync(this.config.logsDir, { recursive: true });
    }
    const filename = `log_${Date.now()}_attempt${log.attempt}.json`;
    const filepath = path.join(this.config.logsDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(log, null, 2), 'utf-8');
  }

  getContextTokens(): number {
    return this.contextTokens;
  }

  getAttempt(): number {
    return this.attempt;
  }
}
