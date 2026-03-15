import { ArenaLoop, ArenaState } from '../../src/phase4/arena-loop';

describe('Arena Loop', () => {
  test('runs optimization iterations', async () => {
    let metricValue = 0;

    const loop = new ArenaLoop({
      objective_name: 'test_metric',
      objective_fn: async () => {
        metricValue += 0.1;
        return metricValue;
      },
      max_iterations: 5,
      improvement_threshold: 0.001,
      optimizer: async (state) => ({
        parameters: { lr: 0.01 * (state.iteration + 1) },
        strategy: `iteration-${state.iteration}`,
      }),
    });

    const result = await loop.run();
    expect(result.history.length).toBeGreaterThanOrEqual(1);
    expect(result.best_metric).toBeGreaterThan(0);
  });

  test('stops when improvement is below threshold', async () => {
    let callCount = 0;

    const loop = new ArenaLoop({
      objective_name: 'converging',
      objective_fn: async () => {
        callCount++;
        return 1.0; // flat metric — no improvement
      },
      max_iterations: 100,
      improvement_threshold: 0.01,
      optimizer: async () => ({
        parameters: {},
        strategy: 'no-change',
      }),
    });

    const result = await loop.run();
    // Should stop early due to convergence
    expect(result.history.length).toBeLessThan(100);
  });

  test('tracks best metric across iterations', async () => {
    const metrics = [0.5, 0.8, 0.3, 0.9, 0.7];
    let idx = -1;

    const loop = new ArenaLoop({
      objective_name: 'best_tracker',
      objective_fn: async () => {
        idx++;
        return metrics[Math.min(idx, metrics.length - 1)];
      },
      max_iterations: 4,
      improvement_threshold: 0,
      optimizer: async () => ({ parameters: {}, strategy: 'test' }),
    });

    const result = await loop.run();
    expect(result.best_metric).toBe(0.9);
  });

  test('can be stopped externally', async () => {
    const loop = new ArenaLoop({
      objective_name: 'stoppable',
      objective_fn: async (state) => {
        if (state.iteration === 2) loop.stop();
        return state.iteration;
      },
      max_iterations: 100,
      improvement_threshold: 0,
      optimizer: async () => ({ parameters: {}, strategy: 'test' }),
    });

    const result = await loop.run();
    expect(result.history.length).toBeLessThanOrEqual(3);
    expect(loop.isRunning()).toBe(false);
  });

  test('getProgress returns current state', async () => {
    const loop = new ArenaLoop({
      objective_name: 'progress',
      objective_fn: async () => 1,
      max_iterations: 3,
      improvement_threshold: 0,
      optimizer: async () => ({ parameters: {}, strategy: 'test' }),
    });

    const progress = loop.getProgress();
    expect(progress.iteration).toBe(0);
    expect(progress.max).toBe(3);
  });
});
