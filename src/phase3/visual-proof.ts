/**
 * Phase 3: Visual Proof System (Stub)
 * Defines the interface for post-task visual verification hooks.
 * Stub implementation that generates proof reports with placeholders.
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
  path: string; // placeholder path
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

/**
 * Stub implementation of visual proof system.
 * In production, this would use browser automation (Playwright/Puppeteer).
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
   * Creates a stub proof report (no real browser automation).
   */
  static createStubReport(context: ProofContext): ProofReport {
    const checks: ProofCheck[] = (context.expected_states ?? []).map(state => ({
      description: state.description,
      passed: true, // stub always passes
      details: 'Stub verification — no real browser automation executed',
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
      status: checks.every(c => c.passed) ? 'verified' : 'failed',
      screenshots,
      checks,
      markdown,
    };
  }
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
