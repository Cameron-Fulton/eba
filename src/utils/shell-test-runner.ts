/**
 * Shell Test Runner
 * Runs a shell command as the deterministic test step in the Ralph Wiggum loop.
 * Pass/fail is determined by the process exit code.
 * stdout + stderr are captured and returned as output.
 */

import { exec } from 'child_process';
import { TestRunner, TestResult } from '../phase1/orchestrator';

export interface ShellTestRunnerConfig {
  /** Command to run, e.g. "npm test" or "npm run lint && npm test" */
  command: string;
  /** Working directory to run the command in */
  cwd: string;
  /** Timeout in milliseconds (default: 120000) */
  timeoutMs?: number;
}

export interface RetryWithBackoffOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  multiplier?: number;
}

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryWithBackoffOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 500,
    multiplier = 2,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts) {
        break;
      }

      const delayMs = baseDelayMs * (multiplier ** (attempt - 1));
      await new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
      });
    }
  }

  throw lastError;
}

export class ShellTestRunner implements TestRunner {
  private config: ShellTestRunnerConfig;

  constructor(config: ShellTestRunnerConfig) {
    this.config = config;
  }

  run(): Promise<TestResult> {
    const start = Date.now();
    const timeoutMs = this.config.timeoutMs ?? 120_000;

    return new Promise((resolve) => {
      const child = exec(
        this.config.command,
        {
          cwd:     this.config.cwd,
          timeout: timeoutMs,
          env:     { ...process.env },
        },
        (error, stdout, stderr) => {
          const duration_ms = Date.now() - start;
          const output      = [stdout, stderr].filter(Boolean).join('\n').trim();
          const passed      = !error;

          resolve({ passed, output, duration_ms });
        }
      );
    });
  }
}
