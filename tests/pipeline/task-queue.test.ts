import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TaskQueue } from '../../src/pipeline/task-queue';

describe('TaskQueue', () => {
  let dbPath: string;
  let queue: TaskQueue;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eba-queue-'));
    dbPath = path.join(tmpDir, 'test-queue.db');
    queue = new TaskQueue(dbPath);
  });

  afterEach(() => {
    queue.close();
  });

  test('enqueue returns a task ID', () => {
    const id = queue.enqueue({ task: 'Do something' });
    expect(id).toMatch(/^task_/);
  });

  test('peek shows correct counts', () => {
    queue.enqueue({ task: 'Task 1' });
    queue.enqueue({ task: 'Task 2' });
    const stats = queue.peek();
    expect(stats.pending).toBe(2);
    expect(stats.claimed).toBe(0);
  });

  test('claim returns highest priority pending task', () => {
    queue.enqueue({ task: 'Low priority', priority: 1 });
    queue.enqueue({ task: 'High priority', priority: 10 });
    const claimed = queue.claim('agent_1');
    expect(claimed).not.toBeNull();
    expect(claimed!.task).toBe('High priority');
    expect(claimed!.priority).toBe(10);
  });

  test('claim returns null when no pending tasks', () => {
    const claimed = queue.claim('agent_1');
    expect(claimed).toBeNull();
  });

  test('claimed task is not claimable by another agent', () => {
    queue.enqueue({ task: 'Only one' });
    const first = queue.claim('agent_1');
    const second = queue.claim('agent_2');
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  test('complete transitions task to completed', () => {
    const id = queue.enqueue({ task: 'Finish me' });
    queue.claim('agent_1');
    queue.complete(id, { episodeSummary: 'Done', artifacts: [], status: 'success' });
    const stats = queue.peek();
    expect(stats.completed).toBe(1);
    expect(stats.claimed).toBe(0);
  });

  test('fail transitions task to failed', () => {
    const id = queue.enqueue({ task: 'Fail me' });
    queue.claim('agent_1');
    queue.fail(id, 'something broke');
    const stats = queue.peek();
    expect(stats.failed).toBe(1);
  });

  test('release returns claimed task to pending', () => {
    const id = queue.enqueue({ task: 'Release me' });
    queue.claim('agent_1');
    queue.release(id);
    const stats = queue.peek();
    expect(stats.pending).toBe(1);
    expect(stats.claimed).toBe(0);
  });

  test('release of failed task returns to pending (retry)', () => {
    const id = queue.enqueue({ task: 'Retry me' });
    queue.claim('agent_1');
    queue.fail(id, 'temp error');
    queue.release(id);
    const stats = queue.peek();
    expect(stats.pending).toBe(1);
    expect(stats.failed).toBe(0);
  });

  test('blocked transitions pending task to blocked', () => {
    const id = queue.enqueue({ task: 'Block me' });
    queue.blocked(id, 'waiting on external');
    const stats = queue.peek();
    expect(stats.blocked).toBe(1);
    expect(stats.pending).toBe(0);
  });

  test('staleCheck finds tasks claimed longer than threshold', () => {
    const id = queue.enqueue({ task: 'Stale task' });
    queue.claim('agent_1');
    // Manually backdate claimed_at using ISO format to simulate stale
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    (queue as any).db.prepare(
      `UPDATE tasks SET claimed_at = ? WHERE id = ?`
    ).run(tenMinutesAgo, id);
    const stale = queue.staleCheck(60_000); // 1 minute threshold
    expect(stale).toContain(id);
  });

  test('dependsOn prevents claiming until prerequisite completes', () => {
    const id1 = queue.enqueue({ task: 'Prerequisite' });
    queue.enqueue({ task: 'Dependent', dependsOn: [id1] });
    const claimed = queue.claim('agent_1');
    expect(claimed!.task).toBe('Prerequisite');
    const claimed2 = queue.claim('agent_2');
    expect(claimed2).toBeNull();
    queue.complete(id1, { episodeSummary: 'done', artifacts: [], status: 'success' });
    const claimed3 = queue.claim('agent_2');
    expect(claimed3).not.toBeNull();
    expect(claimed3!.task).toBe('Dependent');
  });

  test('complete throws if task not in claimed status', () => {
    const id = queue.enqueue({ task: 'Not claimed' });
    expect(() => queue.complete(id, { episodeSummary: '', artifacts: [], status: 'success' }))
      .toThrow(/not in 'claimed' status/);
  });

  test('release throws if task in completed status', () => {
    const id = queue.enqueue({ task: 'Done task' });
    queue.claim('agent_1');
    queue.complete(id, { episodeSummary: 'done', artifacts: [], status: 'success' });
    expect(() => queue.release(id)).toThrow(/not in 'claimed', 'blocked', or 'failed' status/);
  });
});
