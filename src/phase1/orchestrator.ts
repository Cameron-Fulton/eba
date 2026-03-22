/**
 * Phase 1: Basic Blueprint Orchestrator
 * Reads active task, invokes LLM (mockable), runs deterministic tests,
 * implements the Ralph Wiggum kill-and-restart pattern.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ToolSchema, ToolShed, ToolExecutionResult } from '../phase2/tool-shed';
import { ThreePillarModel } from '../phase3/three-pillar-model';

export interface LLMProvider {
  call(prompt: string): Promise<string>;
  callWithTools?(messages: Message[], tools: ToolSchema[]): Promise<LLMResponse>;
}

export interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_results?: ToolResult[];
}

export interface ToolCall {
  id: string;
  name: string;
  parameters: Record<string, unknown>;
}

export interface ToolResult {
  tool_call_id: string;
  content: string;
  is_error: boolean;
}

export interface TextResponse {
  type: 'text';
  text: string;
}

export interface ToolCallResponse {
  type: 'tool_calls';
  tool_calls: ToolCall[];
}

export type LLMResponse = TextResponse | ToolCallResponse;

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
  toolShed?: ToolShed;
  threePillarModel?: ThreePillarModel;
  maxToolIterations?: number;
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
  private attempt: number = 0;
  private lastTestOutput: string = '';

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

    this.lastTestOutput = '';

    for (this.attempt = 1; this.attempt <= this.config.maxRetries; this.attempt++) {
      const log = await this.executeSingleAttempt(
        task,
        this.attempt,
        this.attempt > 1 ? this.lastTestOutput : undefined
      );

      logs.push(log);
      if (log.status !== 'restarted' && log.llm_response !== '') {
        this.lastTestOutput = log.test_result.output;
      }

      if (log.status === 'success') {
        break; // Task succeeded
      }
      // Failure/restart — Ralph Wiggum: kill this agent, restart fresh
    }

    return logs;
  }

  public async executeSingleAttempt(
    task: string,
    attempt: number,
    previousFailureOutput?: string
  ): Promise<ExecutionLog> {
    // Fresh agent each attempt (Ralph Wiggum pattern)
    let contextTokens = 0;

    const prompt = this.buildPrompt(task, attempt, previousFailureOutput);
    contextTokens += Math.ceil(prompt.length / 4);

    let llmResponse: string;
    try {
      llmResponse = await this.config.llmProvider.call(prompt);
      contextTokens += Math.ceil(llmResponse.length / 4);
    } catch (err) {
      const log = this.createLog(
        task,
        attempt,
        '',
        { passed: false, output: `LLM error: ${err}`, duration_ms: 0 },
        'failure'
      );
      this.writeLog(log);
      return log;
    }

    // Check context saturation
    if (contextTokens > this.config.contextSaturationThreshold) {
      const log = this.createLog(
        task,
        attempt,
        llmResponse,
        { passed: false, output: 'Context saturated', duration_ms: 0 },
        'restarted'
      );
      this.writeLog(log);
      return log;
    }

    // Run deterministic tests
    const testResult = await this.config.testRunner.run();
    const status = testResult.passed ? 'success' : 'failure';
    const log = this.createLog(task, attempt, llmResponse, testResult, status);
    this.writeLog(log);

    return log;
  }

  /**
   * Agentic tool-calling loop.
   * Loops: call → handle tool_calls → execute → feed results back → repeat until TextResponse or max iterations.
   */
  async executeWithToolLoop(
    task: string,
    tools: ToolSchema[],
    toolShed: ToolShed,
    threePillarModel?: ThreePillarModel,
  ): Promise<{ finalText: string; iterations: number; toolCallsMade: ToolCall[] }> {
    if (!this.config.llmProvider.callWithTools) {
      throw new Error('LLMProvider does not implement callWithTools');
    }

    const maxIterations = this.config.maxToolIterations ?? 10;
    const messages: Message[] = [{ role: 'user', content: task }];
    const allToolCalls: ToolCall[] = [];
    let iterations = 0;

    while (iterations < maxIterations) {
      iterations++;
      const response = await this.config.llmProvider.callWithTools!(messages, tools);

      if (response.type === 'text') {
        return { finalText: response.text, iterations, toolCallsMade: allToolCalls };
      }

      // Append assistant message with tool_calls
      messages.push({ role: 'assistant', content: '', tool_calls: response.tool_calls });

      // Execute each tool call
      const toolResults: ToolResult[] = [];
      for (const toolCall of response.tool_calls) {
        allToolCalls.push(toolCall);

        // 3PM gate — check approval before write/execute tools
        const toolSchema = toolShed.get(toolCall.name);
        const category = toolSchema?.category ?? 'read';
        if (threePillarModel && (category === 'write' || category === 'execute')) {
          const { approved } = await threePillarModel.checkAndApprove(toolCall.name, 'orchestrator');
          if (!approved) {
            toolResults.push({
              tool_call_id: toolCall.id,
              content: `Tool call '${toolCall.name}' was denied by approval gate.`,
              is_error: true,
            });
            continue;
          }
        }

        const result: ToolExecutionResult = toolShed.execute(toolCall.name, toolCall.parameters);
        toolResults.push({
          tool_call_id: toolCall.id,
          content: result.success ? result.output : (result.error ?? 'Tool execution failed'),
          is_error: !result.success,
        });
      }

      // Feed results back into messages
      messages.push({ role: 'tool', content: '', tool_results: toolResults });
    }

    throw new Error(`Tool loop exceeded max iterations (${maxIterations})`);
  }

  private buildPrompt(task: string, attempt: number, previousFailureOutput?: string): string {
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

  private createLog(
    task: string,
    attempt: number,
    llmResponse: string,
    testResult: TestResult,
    status: ExecutionLog['status']
  ): ExecutionLog {
    return {
      timestamp: new Date().toISOString(),
      task,
      attempt,
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

  getAttempt(): number {
    return this.attempt;
  }
}
