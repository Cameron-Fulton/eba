import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface TaskSpec {
  task: string;
  sopId?: string;
  priority?: number;
  dependsOn?: string[];
}

export interface ClaimedTask {
  id: string;
  task: string;
  sopId: string | null;
  priority: number;
  claimedAt: string;
}

export interface TaskResult {
  episodeSummary: string;
  artifacts: string[];
  status: 'success' | 'failure';
}

export interface QueueStats {
  pending: number;
  claimed: number;
  completed: number;
  failed: number;
  blocked: number;
}

export class TaskQueue {
  private db: InstanceType<typeof Database>;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id          TEXT PRIMARY KEY,
        priority    INTEGER NOT NULL DEFAULT 0,
        status      TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'claimed', 'completed', 'failed', 'blocked')),
        claimed_by  TEXT,
        claimed_at  TEXT,
        task_json   TEXT NOT NULL,
        result_json TEXT,
        sop_id      TEXT,
        depends_on  TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, priority DESC);
    `);
  }

  enqueue(spec: TaskSpec): string {
    const id = `task_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO tasks (id, priority, status, task_json, sop_id, depends_on, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)
    `).run(
      id,
      spec.priority ?? 0,
      spec.task,
      spec.sopId ?? null,
      spec.dependsOn ? JSON.stringify(spec.dependsOn) : null,
      now,
      now
    );
    return id;
  }

  claim(agentId: string): ClaimedTask | null {
    const now = new Date().toISOString();
    const row = this.db.prepare(`
      UPDATE tasks
      SET status = 'claimed', claimed_by = ?, claimed_at = ?, updated_at = ?
      WHERE id = (
        SELECT t.id FROM tasks t
        WHERE t.status = 'pending'
          AND (t.depends_on IS NULL OR NOT EXISTS (
            SELECT 1 FROM json_each(t.depends_on) AS dep
            JOIN tasks AS prereq ON prereq.id = dep.value
            WHERE prereq.status != 'completed'
          ))
        ORDER BY t.priority DESC, t.created_at ASC
        LIMIT 1
      )
      RETURNING *
    `).get(agentId, now, now) as any;

    if (!row) return null;

    return {
      id: row.id,
      task: row.task_json,
      sopId: row.sop_id,
      priority: row.priority,
      claimedAt: row.claimed_at,
    };
  }

  complete(taskId: string, result: TaskResult): void {
    const now = new Date().toISOString();
    const info = this.db.prepare(`
      UPDATE tasks SET status = 'completed', result_json = ?, updated_at = ?
      WHERE id = ? AND status = 'claimed'
    `).run(JSON.stringify(result), now, taskId);

    if (info.changes === 0) {
      throw new Error(`Task ${taskId} not in 'claimed' status`);
    }
  }

  fail(taskId: string, error: string): void {
    const now = new Date().toISOString();
    const info = this.db.prepare(`
      UPDATE tasks SET status = 'failed', result_json = ?, updated_at = ?
      WHERE id = ? AND status = 'claimed'
    `).run(JSON.stringify({ error }), now, taskId);

    if (info.changes === 0) {
      throw new Error(`Task ${taskId} not in 'claimed' status`);
    }
  }

  release(taskId: string): void {
    const now = new Date().toISOString();
    const info = this.db.prepare(`
      UPDATE tasks SET status = 'pending', claimed_by = NULL, claimed_at = NULL, updated_at = ?
      WHERE id = ? AND status IN ('claimed', 'blocked', 'failed')
    `).run(now, taskId);

    if (info.changes === 0) {
      throw new Error(`Task ${taskId} not in 'claimed', 'blocked', or 'failed' status`);
    }
  }

  blocked(taskId: string, reason: string): void {
    const now = new Date().toISOString();
    const info = this.db.prepare(`
      UPDATE tasks SET status = 'blocked', result_json = ?, updated_at = ?
      WHERE id = ? AND status IN ('pending', 'claimed')
    `).run(JSON.stringify({ blockedReason: reason }), now, taskId);

    if (info.changes === 0) {
      throw new Error(`Task ${taskId} not in 'pending' or 'claimed' status`);
    }
  }

  peek(): QueueStats {
    const rows = this.db.prepare(`
      SELECT status, COUNT(*) as count FROM tasks GROUP BY status
    `).all() as Array<{ status: string; count: number }>;

    const stats: QueueStats = { pending: 0, claimed: 0, completed: 0, failed: 0, blocked: 0 };
    for (const row of rows) {
      if (row.status in stats) {
        (stats as any)[row.status] = row.count;
      }
    }
    return stats;
  }

  staleCheck(timeoutMs: number): string[] {
    const cutoff = new Date(Date.now() - timeoutMs).toISOString();
    const rows = this.db.prepare(`
      SELECT id FROM tasks WHERE status = 'claimed' AND claimed_at < ?
    `).all(cutoff) as Array<{ id: string }>;
    return rows.map(r => r.id);
  }

  close(): void {
    this.db.close();
  }
}
