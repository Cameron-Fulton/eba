/**
 * Phase 2: Thread Isolation & Episodic Returns
 * Dispatches isolated worker threads that execute a single prompt
 * and return compressed Episodes — not full conversation traces.
 */

export interface Episode {
  thread_id: string;
  task: string;
  result_summary: string;
  artifacts_produced: string[];
  errors_encountered: string[];
  duration_ms: number;
  timestamp: string;
  status: 'success' | 'failure' | 'timeout';
}

export interface ThreadConfig {
  timeout_ms: number;
  max_concurrent: number;
  maxEpisodeHistory?: number;
}

export interface WorkerThread {
  id: string;
  task: string;
  tools: string[];
  execute: () => Promise<Episode>;
}

export type ThreadExecutor = (task: string, tools: string[]) => Promise<{
  result: string;
  artifacts: string[];
  errors: string[];
}>;

export class ThreadManager {
  private config: Required<ThreadConfig>;
  private executor: ThreadExecutor;
  private activeCount: number = 0;
  private completedEpisodes: Episode[] = [];

  constructor(config: ThreadConfig, executor: ThreadExecutor) {
    this.config = {
      ...config,
      maxEpisodeHistory: config.maxEpisodeHistory ?? 500,
    };
    this.executor = executor;
  }

  createThread(task: string, tools: string[]): WorkerThread {
    const id = `thread_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const thread: WorkerThread = {
      id,
      task,
      tools,
      execute: () => this.runThread(id, task, tools),
    };
    return thread;
  }

  private async runThread(id: string, task: string, tools: string[]): Promise<Episode> {
    if (this.activeCount >= this.config.max_concurrent) {
      return {
        thread_id: id,
        task,
        result_summary: '',
        artifacts_produced: [],
        errors_encountered: [`Max concurrent threads (${this.config.max_concurrent}) exceeded`],
        duration_ms: 0,
        timestamp: new Date().toISOString(),
        status: 'failure',
      };
    }

    this.activeCount += 1;
    const start = Date.now();

    try {
      const result = await this.withTimeout(
        this.executor(task, tools),
        this.config.timeout_ms
      );

      const episode: Episode = {
        thread_id: id,
        task,
        result_summary: result.result,
        artifacts_produced: result.artifacts,
        errors_encountered: result.errors,
        duration_ms: Date.now() - start,
        timestamp: new Date().toISOString(),
        status: result.errors.length > 0 ? 'failure' : 'success',
      };

      this.recordEpisode(episode);
      return episode;
    } catch (err) {
      const episode: Episode = {
        thread_id: id,
        task,
        result_summary: '',
        artifacts_produced: [],
        errors_encountered: [err instanceof Error ? err.message : String(err)],
        duration_ms: Date.now() - start,
        timestamp: new Date().toISOString(),
        status: err instanceof Error && err.message.includes('timed out') ? 'timeout' : 'failure',
      };

      this.recordEpisode(episode);
      return episode;
    } finally {
      this.activeCount = Math.max(0, this.activeCount - 1);
    }
  }

  private recordEpisode(episode: Episode): void {
    this.completedEpisodes.push(episode);

    const excess = this.completedEpisodes.length - this.config.maxEpisodeHistory;
    if (excess > 0) {
      this.completedEpisodes.splice(0, excess);
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Thread timed out after ${ms}ms`)), ms);
      // Prevent timeout guard from keeping Node's event loop alive.
      if (typeof (timer as NodeJS.Timeout).unref === 'function') {
        (timer as NodeJS.Timeout).unref();
      }

      promise.then(
        val => { clearTimeout(timer); resolve(val); },
        err => { clearTimeout(timer); reject(err); }
      );
    });
  }

  async dispatch(task: string, tools: string[]): Promise<Episode> {
    const thread = this.createThread(task, tools);
    return thread.execute();
  }

  async dispatchParallel(tasks: { task: string; tools: string[] }[]): Promise<Episode[]> {
    return Promise.all(tasks.map(t => this.dispatch(t.task, t.tools)));
  }

  getCompletedEpisodes(): Episode[] {
    return [...this.completedEpisodes];
  }

  getActiveThreadCount(): number {
    return this.activeCount;
  }
}
