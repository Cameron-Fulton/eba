/**
 * Phase 3: Visual Proof System
 * Defines the interface for post-task visual verification hooks.
 */

export interface VisualProofHook {
  name: string;
  trigger: 'post_test' | 'post_deploy' | 'manual';
  execute: (context: ProofContext) => Promise<ProofReport>;
}

export interface ProofContext {
  task_description: string;
  url?: string;
  selectors?: string[];
  expected_states?: ExpectedState[];
}

export interface ExpectedState {
  description: string;
  selector?: string;
  expected_text?: string;
  expected_visible?: boolean;
}

export interface ProofScreenshot {
  description: string;
  path: string;
  timestamp: string;
}

export interface ProofReport {
  task: string;
  timestamp: string;
  status: 'verified' | 'failed' | 'skipped';
  screenshots: ProofScreenshot[];
  checks: ProofCheck[];
  markdown: string;
}

export interface ProofCheck {
  description: string;
  passed: boolean;
  details?: string;
}

type BrowserPage = {
  goto: (url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }) => Promise<unknown>;
  textContent: (selector: string) => Promise<string | null>;
  locator: (selector: string) => { isVisible: () => Promise<boolean> };
  screenshot: (options: { path: string; fullPage: boolean }) => Promise<Buffer>;
};

type BrowserInstance = {
  newPage: () => Promise<BrowserPage>;
  close: () => Promise<void>;
};

type ChromiumLike = {
  launch: (options: { headless: boolean }) => Promise<BrowserInstance>;
};

/**
 * Visual proof system with pluggable verification hooks.
 */
export class VisualProofSystem {
  private hooks: Map<string, VisualProofHook> = new Map();

  registerHook(hook: VisualProofHook): void {
    this.hooks.set(hook.name, hook);
  }

  getHook(name: string): VisualProofHook | undefined {
    return this.hooks.get(name);
  }

  getHooksByTrigger(trigger: VisualProofHook['trigger']): VisualProofHook[] {
    return Array.from(this.hooks.values()).filter(h => h.trigger === trigger);
  }

  async executeHook(name: string, context: ProofContext): Promise<ProofReport> {
    const hook = this.hooks.get(name);
    if (!hook) throw new Error(`Visual proof hook '${name}' not found`);
    return hook.execute(context);
  }

  /**
   * Factory for a Playwright-powered visual proof hook.
   * Uses runtime loading so projects without Playwright can still compile.
   */
  static createPlaywrightHook(): VisualProofHook {
    const chromium = loadPlaywrightChromium();

    return {
      name: 'playwright',
      trigger: 'post_test',
      execute: async (context: ProofContext): Promise<ProofReport> => {
        const fs = require('fs') as { mkdirSync: (path: string, options?: { recursive?: boolean }) => void };
        const path = require('path') as { join: (...parts: string[]) => string };

        const browser = await chromium.launch({ headless: true });

        try {
          const page = await browser.newPage();

          if (context.url) {
            await page.goto(context.url, { waitUntil: 'networkidle' });
          }

          const checks: ProofCheck[] = [];
          const screenshots: ProofScreenshot[] = [];
          const expectedStates = context.expected_states ?? [];

          const screenshotDir = path.join(process.cwd(), 'screenshots');
          fs.mkdirSync(screenshotDir, { recursive: true });

          for (let i = 0; i < expectedStates.length; i++) {
            const state = expectedStates[i];
            const details: string[] = [];
            let passed = true;

            if (state.selector && state.expected_text !== undefined) {
              const text = await page.textContent(state.selector);
              const matched = (text ?? '').includes(state.expected_text);
              passed = passed && matched;
              details.push(
                matched
                  ? `Text matched for selector '${state.selector}'`
                  : `Expected text '${state.expected_text}' not found in selector '${state.selector}'`
              );
            }

            if (state.selector && state.expected_visible !== undefined) {
              let visible = false;
              try {
                visible = await page.locator(state.selector).isVisible();
              } catch {
                visible = false;
              }

              const matched = visible === state.expected_visible;
              passed = passed && matched;
              details.push(
                matched
                  ? `Visibility matched (${visible}) for selector '${state.selector}'`
                  : `Expected visibility=${state.expected_visible} but got ${visible} for selector '${state.selector}'`
              );
            }

            if (!state.selector || (state.expected_text === undefined && state.expected_visible === undefined)) {
              details.push('No explicit selector assertion provided for this state');
            }

            checks.push({
              description: state.description,
              passed,
              details: details.join(' | '),
            });

            const screenshotPath = path.join(screenshotDir, `proof_${Date.now()}_${i + 1}.png`);
            await page.screenshot({ path: screenshotPath, fullPage: true });
            screenshots.push({
              description: state.description,
              path: screenshotPath,
              timestamp: new Date().toISOString(),
            });
          }

          const status: ProofReport['status'] =
            checks.length === 0 ? 'skipped' : checks.every(check => check.passed) ? 'verified' : 'failed';

          const markdown = generateProofMarkdown(context, checks, screenshots);

          return {
            task: context.task_description,
            timestamp: new Date().toISOString(),
            status,
            screenshots,
            checks,
            markdown,
          };
        } finally {
          await browser.close();
        }
      },
    };
  }

  /**
   * WARNING: This is a non-verifying stub that does NOT run browser automation.
   * Creates a stub proof report (no real browser automation).
   */
  static createStubReport(context: ProofContext): ProofReport {
    const checks: ProofCheck[] = (context.expected_states ?? []).map(state => ({
      description: state.description,
      passed: false,
      details: 'Stub — no browser automation executed',
    }));

    const screenshots: ProofScreenshot[] = [
      {
        description: 'Initial page load',
        path: '/screenshots/stub_initial.png',
        timestamp: new Date().toISOString(),
      },
      {
        description: 'After interaction',
        path: '/screenshots/stub_interaction.png',
        timestamp: new Date().toISOString(),
      },
    ];

    const markdown = generateProofMarkdown(context, checks, screenshots);

    return {
      task: context.task_description,
      timestamp: new Date().toISOString(),
      status: 'skipped',
      screenshots,
      checks,
      markdown,
    };
  }
}

function loadPlaywrightChromium(): ChromiumLike {
  const errorMessage =
    'Playwright not configured — install @playwright/test or playwright-core and ensure chromium is available';

  try {
    const playwrightTest = require('@playwright/test') as { chromium?: ChromiumLike };
    if (playwrightTest.chromium) return playwrightTest.chromium;
  } catch {
    // fallback below
  }

  try {
    const playwrightCore = require('playwright-core') as { chromium?: ChromiumLike };
    if (playwrightCore.chromium) return playwrightCore.chromium;
  } catch {
    // handled below
  }

  throw new Error(errorMessage);
}

function generateProofMarkdown(
  context: ProofContext,
  checks: ProofCheck[],
  screenshots: ProofScreenshot[]
): string {
  const lines: string[] = [
    '# Visual Proof Report',
    '',
    `**Task:** ${context.task_description}`,
    `**Date:** ${new Date().toISOString()}`,
    `**URL:** ${context.url ?? 'N/A'}`,
    '',
    '## Verification Checks',
    '',
  ];

  for (const check of checks) {
    const icon = check.passed ? '✅' : '❌';
    lines.push(`- ${icon} ${check.description}`);
    if (check.details) lines.push(`  - ${check.details}`);
  }

  lines.push('', '## Screenshots', '');
  for (const ss of screenshots) {
    lines.push(`### ${ss.description}`);
    lines.push(`![${ss.description}](${ss.path})`);
    lines.push(`*Captured: ${ss.timestamp}*`);
    lines.push('');
  }

  const passCount = checks.filter(c => c.passed).length;
  lines.push('## Summary', '');
  lines.push(`**Result:** ${passCount}/${checks.length} checks passed`);

  return lines.join('\n');
}
