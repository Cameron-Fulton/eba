/**
 * AIIndex: SQLite FTS5-backed search index for NegativeKnowledgeStore.
 * Source of truth stays as Markdown in docs/solutions/ — this index is derived and rebuildable.
 * DB path: .ai_index/index.db (gitignored)
 */

import * as fs from 'fs';
import * as path from 'path';
import type { NegativeKnowledgeEntry } from './negative-knowledge';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SqliteDatabase: (new (path: string) => any) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  SqliteDatabase = require('better-sqlite3') as new (path: string) => any;
} catch {
  // better-sqlite3 not available (missing native build) — will use in-memory fallback
}

export class AIIndex {
  private useSqlite = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any = null;
  private ready = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private stmtUpsertEntry: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private stmtDeleteFts: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private stmtInsertFts: any = null;
  private memoryStore = new Map<string, NegativeKnowledgeEntry>();

  constructor(private readonly dbPath: string) {
    if (SqliteDatabase) {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.db = new SqliteDatabase(dbPath);
      this.useSqlite = true;
      this.initSqlite();
      return;
    }

    this.useSqlite = false;
    this.ready = true;
    console.warn('[AIIndex] better-sqlite3 not available — using in-memory fallback (no FTS5)');
  }

  private initSqlite(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nk_entries (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS nk_fts USING fts5(
        id UNINDEXED,
        scenario,
        attempt,
        outcome,
        solution,
        tags,
        tokenize='porter ascii'
      );
    `);

    this.stmtUpsertEntry = this.db.prepare(`
      INSERT INTO nk_entries (id, data) VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data
    `);
    this.stmtDeleteFts = this.db.prepare('DELETE FROM nk_fts WHERE id = ?');
    this.stmtInsertFts = this.db.prepare(`
      INSERT INTO nk_fts (id, scenario, attempt, outcome, solution, tags)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.ready = true;
  }

  index(entry: NegativeKnowledgeEntry): void {
    if (!this.ready) return;

    if (this.useSqlite) {
      const run = this.db.transaction(() => {
        this.stmtUpsertEntry.run(entry.id, JSON.stringify(entry));
        this.stmtDeleteFts.run(entry.id);
        this.stmtInsertFts.run(
          entry.id,
          entry.scenario,
          entry.attempt,
          entry.outcome,
          entry.solution,
          entry.tags.join(' ')
        );
      });
      run();
      return;
    }

    this.memoryStore.set(entry.id, entry);
  }

  remove(id: string): void {
    if (!this.ready) return;

    if (this.useSqlite) {
      const run = this.db.transaction(() => {
        this.db.prepare('DELETE FROM nk_entries WHERE id = ?').run(id);
        this.db.prepare('DELETE FROM nk_fts WHERE id = ?').run(id);
      });
      run();
      return;
    }

    this.memoryStore.delete(id);
  }

  search(keyword: string): NegativeKnowledgeEntry[] {
    if (!this.ready || !keyword.trim()) return [];

    if (this.useSqlite) {
      // Sanitize keyword for FTS5 MATCH: escape double quotes, strip FTS5
      // operators (AND, OR, NOT, NEAR, *, ^), and wrap in double quotes for
      // safe term matching.
      const sanitized = keyword
        .replace(/"/g, '""')
        .replace(/\b(AND|OR|NOT|NEAR)\b/g, '')
        .replace(/[*^]/g, '')
        .trim();
      if (!sanitized) return [];
      const safeTerm = `"${sanitized}"`;

      try {
        const rows = this.db.prepare(`
          SELECT e.data
          FROM nk_fts f
          JOIN nk_entries e ON e.id = f.id
          WHERE nk_fts MATCH ?
          ORDER BY rank
        `).all(safeTerm) as { data: string }[];

        return rows.map(r => JSON.parse(r.data) as NegativeKnowledgeEntry);
      } catch {
        // FTS5 match syntax error — fall back to empty so caller can use linear scan
        return [];
      }
    }

    const term = keyword.trim().toLowerCase();
    const results: NegativeKnowledgeEntry[] = [];
    for (const entry of this.memoryStore.values()) {
      const haystack = [
        entry.scenario,
        entry.attempt,
        entry.outcome,
        entry.solution,
        entry.tags.join(' '),
      ].join(' ').toLowerCase();

      if (haystack.includes(term)) {
        results.push(entry);
      }
    }
    return results;
  }

  rebuildFromDisk(
    solutionsDir: string,
    parseMarkdown: (content: string, fallbackId: string) => NegativeKnowledgeEntry | null
  ): number {
    if (!this.ready) return 0;
    if (!fs.existsSync(solutionsDir)) return 0;

    if (this.useSqlite) {
      this.db.exec('DELETE FROM nk_entries; DELETE FROM nk_fts;');
    } else {
      this.memoryStore.clear();
    }

    const files = fs.readdirSync(solutionsDir).filter(f => f.endsWith('.md'));
    let count = 0;
    for (const file of files) {
      const content = fs.readFileSync(path.join(solutionsDir, file), 'utf-8');
      const entry = parseMarkdown(content, file.replace('.md', ''));
      if (entry) {
        this.index(entry);
        count++;
      }
    }
    return count;
  }

  close(): void {
    if (!this.ready) return;

    if (this.useSqlite && this.db) {
      this.db.close();
    }
    this.ready = false;
  }
}
