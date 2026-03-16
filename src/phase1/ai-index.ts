/**
 * AIIndex: SQLite FTS5-backed search index for NegativeKnowledgeStore.
 * Source of truth stays as Markdown in docs/solutions/ — this index is derived and rebuildable.
 * DB path: .ai_index/index.db (gitignored)
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import type { NegativeKnowledgeEntry } from './negative-knowledge';

export class AIIndex {
  private db: Database.Database;
  private ready = false;

  constructor(private readonly dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.init();
  }

  private init(): void {
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
    this.ready = true;
  }

  index(entry: NegativeKnowledgeEntry): void {
    if (!this.ready) return;

    // Upsert into entries table
    const upsertEntry = this.db.prepare(`
      INSERT INTO nk_entries (id, data) VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data
    `);

    // Delete old FTS row then reinsert (FTS5 doesn't support ON CONFLICT)
    const deleteFts = this.db.prepare(`DELETE FROM nk_fts WHERE id = ?`);
    const insertFts = this.db.prepare(`
      INSERT INTO nk_fts (id, scenario, attempt, outcome, solution, tags)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const run = this.db.transaction(() => {
      upsertEntry.run(entry.id, JSON.stringify(entry));
      deleteFts.run(entry.id);
      insertFts.run(
        entry.id,
        entry.scenario,
        entry.attempt,
        entry.outcome,
        entry.solution,
        entry.tags.join(' ')
      );
    });
    run();
  }

  remove(id: string): void {
    if (!this.ready) return;
    const run = this.db.transaction(() => {
      this.db.prepare('DELETE FROM nk_entries WHERE id = ?').run(id);
      this.db.prepare('DELETE FROM nk_fts WHERE id = ?').run(id);
    });
    run();
  }

  search(keyword: string): NegativeKnowledgeEntry[] {
    if (!this.ready || !keyword.trim()) return [];

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

  rebuildFromDisk(
    solutionsDir: string,
    parseMarkdown: (content: string, fallbackId: string) => NegativeKnowledgeEntry | null
  ): number {
    if (!this.ready) return 0;
    if (!fs.existsSync(solutionsDir)) return 0;

    // Clear existing index
    this.db.exec('DELETE FROM nk_entries; DELETE FROM nk_fts;');

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
    this.db.close();
    this.ready = false;
  }
}
