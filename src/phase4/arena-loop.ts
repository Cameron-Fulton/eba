/**
 * Phase 4: Arena Loop
 * Optimization engine that runs iterative cycles targeting a metric.
 * Tracks progress across iterations with configurable objective functions.
 */

export interface ArenaConfig {
  objective_name: string;
  objective_fn: (state: ArenaState) => Promise<number>; // returns metric value
  max_iterations: number;
  improvement_threshold: number; // minimum improvement to continue
  optimizer: ArenaOptimizer;
}

export interface ArenaState {
  iteration: number;
  current_metric: number;
  best_metric: number;
  history: IterationResult[];
  parameters: Record<string, unknown>;
}

export interface IterationResult {
  iteration: number;
  metric_value: number;
  improvement: number;
  parameters_used: Record<string, unknown>;
  timestamp: string;
  notes: string;
}

export type ArenaOptimizer = (state: ArenaState) => Promise<{
  parameters: Record<string, unknown>;
  strategy: string;
}>;

export class ArenaLoop {
  private config: ArenaConfig;
  private state: ArenaState;
  private running: boolean = false;

  constructor(config: ArenaConfig, initialParams: Record<string, unknown> = {}) {
    this.config = config;
    this.state = {
      iteration: 0,
      current_metric: 0,
      best_metric: -Infinity,
      history: [],
      parameters: initialParams,
    };
  }

  async run(): Promise<ArenaState> {
    this.running = true;

    // Measure baseline
    try {
      this.state.current_metric = await this.config.objective_fn(this.state);
      this.state.best_metric = this.state.current_metric;
    } catch {
      this.running = false;
      return this.getState();
    }

    for (let i = 1; i <= this.config.max_iterations && this.running; i++) {
      this.state.iteration = i;

      let optimization: Awaited<ReturnType<ArenaOptimizer>>;
      try {
        // Ask optimizer for next parameters/strategy
        optimization = await this.config.optimizer(this.state);
      } catch {
        this.running = false;
        return this.getState();
      }

      const previousMetric = this.state.current_metric;

      // Apply new parameters
      this.state.parameters = { ...this.state.parameters, ...optimization.parameters };

      // Measure new metric
      let newMetric: number;
      try {
        newMetric = await this.config.objective_fn(this.state);
      } catch {
        this.running = false;
        return this.getState();
      }

      const improvement = newMetric - previousMetric;

      this.state.current_metric = newMetric;
      if (newMetric > this.state.best_metric) {
        this.state.best_metric = newMetric;
      }

      const result: IterationResult = {
        iteration: i,
        metric_value: newMetric,
        improvement,
        parameters_used: { ...this.state.parameters },
        timestamp: new Date().toISOString(),
        notes: `Strategy: ${optimization.strategy}. Improvement: ${improvement.toFixed(4)}`,
      };

      this.state.history.push(result);

      // Check if improvement is below threshold (convergence)
      if (i > 1 && improvement >= 0 && improvement < this.config.improvement_threshold) {
        break;
      }
    }

    this.running = false;
    return this.getState();
  }

  stop(): void {
    this.running = false;
  }

  getState(): ArenaState {
    return {
      ...this.state,
      history: [...this.state.history],
      parameters: { ...this.state.parameters },
    };
  }

  isRunning(): boolean {
    return this.running;
  }

  getProgress(): { iteration: number; max: number; best_metric: number } {
    return {
      iteration: this.state.iteration,
      max: this.config.max_iterations,
      best_metric: this.state.best_metric,
    };
  }
}
