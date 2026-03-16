import {
  ProofContext,
  ProofReport,
  VisualProofHook,
  VisualProofSystem,
} from '../../src/phase3/visual-proof';

describe('VisualProofSystem', () => {
  const baseContext: ProofContext = {
    task_description: 'Verify dashboard welcome state',
    url: 'https://example.com',
    expected_states: [
      {
        description: 'Welcome banner is visible',
        selector: '#welcome-banner',
        expected_visible: true,
      },
    ],
  };

  function makeReport(task: string): ProofReport {
    return {
      task,
      timestamp: new Date().toISOString(),
      status: 'verified',
      screenshots: [
        {
          description: 'Captured state',
          path: '/tmp/proof.png',
          timestamp: new Date().toISOString(),
        },
      ],
      checks: [
        {
          description: 'Banner visible',
          passed: true,
        },
      ],
      markdown: '# Visual Proof Report',
    };
  }

  test('registerHook() registers a hook and getHook() retrieves it', () => {
    const system = new VisualProofSystem();

    const hook: VisualProofHook = {
      name: 'manual-review',
      trigger: 'manual',
      execute: async () => makeReport('Manual check'),
    };

    system.registerHook(hook);
    expect(system.getHook('manual-review')).toBeDefined();
    expect(system.getHook('manual-review')?.name).toBe('manual-review');
  });

  test("getHooksByTrigger() filters hooks by trigger type ('post_test', 'post_deploy', 'manual')", () => {
    const system = new VisualProofSystem();

    system.registerHook({
      name: 'pt-1',
      trigger: 'post_test',
      execute: async () => makeReport('Post test 1'),
    });
    system.registerHook({
      name: 'pd-1',
      trigger: 'post_deploy',
      execute: async () => makeReport('Post deploy 1'),
    });
    system.registerHook({
      name: 'm-1',
      trigger: 'manual',
      execute: async () => makeReport('Manual 1'),
    });
    system.registerHook({
      name: 'pt-2',
      trigger: 'post_test',
      execute: async () => makeReport('Post test 2'),
    });

    expect(system.getHooksByTrigger('post_test').map(h => h.name)).toEqual(['pt-1', 'pt-2']);
    expect(system.getHooksByTrigger('post_deploy').map(h => h.name)).toEqual(['pd-1']);
    expect(system.getHooksByTrigger('manual').map(h => h.name)).toEqual(['m-1']);
  });

  test('executeHook() executes a registered hook and returns a ProofReport', async () => {
    const system = new VisualProofSystem();

    system.registerHook({
      name: 'runner',
      trigger: 'manual',
      execute: async context => makeReport(context.task_description),
    });

    const report = await system.executeHook('runner', baseContext);
    expect(report.task).toBe(baseContext.task_description);
    expect(report.status).toBe('verified');
    expect(Array.isArray(report.checks)).toBe(true);
  });

  test('executeHook() throws when hook name is not found', async () => {
    const system = new VisualProofSystem();

    await expect(system.executeHook('missing-hook', baseContext)).rejects.toThrow(
      "Visual proof hook 'missing-hook' not found"
    );
  });

  test("createStubReport() returns a report with status 'skipped'", () => {
    const report = VisualProofSystem.createStubReport(baseContext);
    expect(report.status).toBe('skipped');
  });

  test('createStubReport() generates markdown containing the task description', () => {
    const report = VisualProofSystem.createStubReport(baseContext);
    expect(report.markdown).toContain(baseContext.task_description);
  });

  test("createPlaywrightHook() throws with the 'Playwright not configured' message", () => {
    jest.resetModules();

    jest.doMock('@playwright/test', () => ({}), { virtual: true });
    jest.doMock('playwright-core', () => ({}), { virtual: true });

    jest.isolateModules(() => {
      const {
        VisualProofSystem: IsolatedVisualProofSystem,
      } = require('../../src/phase3/visual-proof') as typeof import('../../src/phase3/visual-proof');

      expect(() => IsolatedVisualProofSystem.createPlaywrightHook()).toThrow('Playwright not configured');
    });

    jest.dontMock('@playwright/test');
    jest.dontMock('playwright-core');
  });

  test('ProofReport shape includes task, timestamp, status, screenshots, checks, markdown', () => {
    const report = VisualProofSystem.createStubReport(baseContext);

    expect(report).toEqual(
      expect.objectContaining({
        task: expect.any(String),
        timestamp: expect.any(String),
        status: expect.any(String),
        screenshots: expect.any(Array),
        checks: expect.any(Array),
        markdown: expect.any(String),
      })
    );
  });
});
