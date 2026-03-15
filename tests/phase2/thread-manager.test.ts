import { ThreadManager, ThreadExecutor, Episode } from '../../src/phase2/thread-manager';

describe('Thread Manager', () => {
  function createSuccessExecutor(): ThreadExecutor {
    return async (task, tools) => ({
      result: `Completed: ${task}`,
      artifacts: ['output.ts'],
      errors: [],
    });
  }

  function createFailingExecutor(): ThreadExecutor {
    return async () => ({
      result: '',
      artifacts: [],
      errors: ['Something went wrong'],
    });
  }

  test('dispatches a thread and returns an episode', async () => {
    const manager = new ThreadManager(
      { timeout_ms: 5000, max_concurrent: 5 },
      createSuccessExecutor()
    );

    const episode = await manager.dispatch('Build feature', ['file_write']);
    expect(episode.status).toBe('success');
    expect(episode.result_summary).toContain('Build feature');
    expect(episode.artifacts_produced).toContain('output.ts');
    expect(episode.errors_encountered).toHaveLength(0);
    expect(episode.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test('returns failure episode on errors', async () => {
    const manager = new ThreadManager(
      { timeout_ms: 5000, max_concurrent: 5 },
      createFailingExecutor()
    );

    const episode = await manager.dispatch('Broken task', ['bash']);
    expect(episode.status).toBe('failure');
    expect(episode.errors_encountered.length).toBeGreaterThan(0);
  });

  test('handles thread timeout', async () => {
    const slowExecutor: ThreadExecutor = async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      return { result: 'done', artifacts: [], errors: [] };
    };

    const manager = new ThreadManager(
      { timeout_ms: 50, max_concurrent: 5 },
      slowExecutor
    );

    const episode = await manager.dispatch('Slow task', []);
    expect(episode.status).toBe('timeout');
    expect(episode.errors_encountered[0]).toContain('timed out');
  });

  test('dispatches multiple threads in parallel', async () => {
    const manager = new ThreadManager(
      { timeout_ms: 5000, max_concurrent: 10 },
      createSuccessExecutor()
    );

    const episodes = await manager.dispatchParallel([
      { task: 'Task A', tools: ['file_read'] },
      { task: 'Task B', tools: ['file_write'] },
      { task: 'Task C', tools: ['bash'] },
    ]);

    expect(episodes).toHaveLength(3);
    expect(episodes.every(e => e.status === 'success')).toBe(true);
  });

  test('enforces max concurrent threads', async () => {
    const blockingExecutor: ThreadExecutor = async () => {
      await new Promise(resolve => setTimeout(resolve, 200));
      return { result: 'done', artifacts: [], errors: [] };
    };

    const manager = new ThreadManager(
      { timeout_ms: 5000, max_concurrent: 1 },
      blockingExecutor
    );

    // First dispatch should work
    const p1 = manager.dispatch('Task 1', []);
    // Give a tiny delay so the first thread registers
    await new Promise(resolve => setTimeout(resolve, 10));
    // Second should get a failure episode since max_concurrent = 1
    const p2 = manager.dispatch('Task 2', []);

    const [e1, e2] = await Promise.all([p1, p2]);
    // One should succeed, the other should fail with max concurrent error
    const statuses = [e1.status, e2.status];
    expect(statuses).toContain('success');
    expect(statuses).toContain('failure');
  });

  test('tracks completed episodes', async () => {
    const manager = new ThreadManager(
      { timeout_ms: 5000, max_concurrent: 5 },
      createSuccessExecutor()
    );

    await manager.dispatch('Task 1', []);
    await manager.dispatch('Task 2', []);

    const episodes = manager.getCompletedEpisodes();
    expect(episodes).toHaveLength(2);
  });

  test('episode contains correct thread_id format', async () => {
    const manager = new ThreadManager(
      { timeout_ms: 5000, max_concurrent: 5 },
      createSuccessExecutor()
    );

    const episode = await manager.dispatch('Test', []);
    expect(episode.thread_id).toMatch(/^thread_/);
  });
});
