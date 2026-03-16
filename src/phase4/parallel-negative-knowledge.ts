/**
 * Phase 4: Parallel Negative Knowledge
 * Multiple threads check the negative knowledge store before attempting work.
 * Threads avoid approaches already marked as failed.
 * Thread-safe concurrent read access to the solutions store.
 */

import { NegativeKnowledgeStore, NegativeKnowledgeEntry } from '../phase1/negative-knowledge';

export interface TaskAttempt {
  thread_id: string;
  task: string;
  approach: string;
  avoided_approaches: string[];
  result: 'success' | 'failure';
  timestamp: string;
}

export class ParallelNegativeKnowledge {
  private store: NegativeKnowledgeStore;
  private attempts: TaskAttempt[] = [];

  constructor(store: NegativeKnowledgeStore) {
    this.store = store;
  }

  /**
   * Check the store for known failures before starting work.
   * Returns approaches that should be avoided for a given task.
   */
  checkBeforeAttempt(task: string): NegativeKnowledgeEntry[] {
    return this.store.searchByKeyword(task);
  }

  /**
   * Get a filtered list of approaches to avoid, extracted from negative knowledge.
   */
  async getAvoidedApproaches(task: string): Promise<string[]> {
    const entries = this.checkBeforeAttempt(task);
    return entries.map(e => e.attempt);
  }

  /**
   * Record a task attempt (success or failure).
   * If failed, adds to negative knowledge so other threads avoid it.
   */
  async recordAttempt(attempt: TaskAttempt): Promise<void> {
    this.attempts.push(attempt);

    if (attempt.result === 'failure') {
      this.store.add({
        scenario: attempt.task,
        attempt: attempt.approach,
        outcome: 'Failed',
        solution: `Avoid approach: ${attempt.approach}`,
        tags: ['auto-recorded', 'parallel-thread'],
      });
    }
  }

  /**
   * Run multiple threads in parallel, each checking negative knowledge first.
   */
  async runParallelTasks(
    tasks: Array<{
      thread_id: string;
      task: string;
      approaches: string[];
      execute: (approach: string) => Promise<boolean>;
    }>
  ): Promise<TaskAttempt[]> {
    const results = await Promise.all(
      tasks.map(async (taskDef) => {
        const avoided = await this.getAvoidedApproaches(taskDef.task);
        const viableApproaches = taskDef.approaches.filter(a => !avoided.includes(a));

        if (viableApproaches.length === 0) {
          const attempt: TaskAttempt = {
            thread_id: taskDef.thread_id,
            task: taskDef.task,
            approach: 'none_available',
            avoided_approaches: avoided,
            result: 'failure',
            timestamp: new Date().toISOString(),
          };
          await this.recordAttempt(attempt);
          return attempt;
        }

        // Try the first viable approach
        const approach = viableApproaches[0];
        const success = await taskDef.execute(approach);

        const attempt: TaskAttempt = {
          thread_id: taskDef.thread_id,
          task: taskDef.task,
          approach,
          avoided_approaches: avoided,
          result: success ? 'success' : 'failure',
          timestamp: new Date().toISOString(),
        };

        await this.recordAttempt(attempt);
        return attempt;
      })
    );

    return results;
  }

  getAttempts(): TaskAttempt[] {
    return [...this.attempts];
  }

  getStore(): NegativeKnowledgeStore {
    return this.store;
  }
}
