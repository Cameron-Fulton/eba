/**
 * Phase 1: Negative Knowledge Store
 * Prevents agents from repeating known-failed approaches.
 * Stores structured entries in Scenario → Attempt → Solution format.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { AIIndex } from './ai-index';

export interface NegativeKnowledgeEntry {
  id: string;
  scenario: string;
  attempt: string;
  outcome: string;
  solution: string;
  tags: string[];
  timestamp: string;
}

/** Parse a negative-knowledge markdown file into a structured entry. */
export function parseNKMarkdown(content: string, fallbackId: string): NegativeKnowledgeEntry | null {
  const lines = content.split('\n');
  const scenarioMatch = lines[0]?.match(/^# (.+)$/);
  if (!scenarioMatch) return null;

  const idMatch = content.match(/\*\*ID:\*\* (.+)/);
  const dateMatch = content.match(/\*\*Date:\*\* (.+)/);
  const tagsMatch = content.match(/\*\*Tags:\*\* (.+)/);

  const attemptIdx = lines.findIndex(l => l === '## Attempt');
  const outcomeIdx = lines.findIndex(l => l === '## Outcome');
  const solutionIdx = lines.findIndex(l => l === '## Solution');

  const attempt = attemptIdx >= 0 && outcomeIdx >= 0
    ? lines.slice(attemptIdx + 1, outcomeIdx).join('\n').trim()
    : '';
  const outcome = outcomeIdx >= 0 && solutionIdx >= 0
    ? lines.slice(outcomeIdx + 1, solutionIdx).join('\n').trim()
    : '';
  const solution = solutionIdx >= 0
    ? lines.slice(solutionIdx + 1).join('\n').trim()
    : '';

  return {
    id: idMatch?.[1] ?? fallbackId,
    scenario: scenarioMatch[1],
    attempt,
    outcome,
    solution,
    tags: tagsMatch?.[1]?.split(', ').filter(Boolean) ?? [],
    timestamp: dateMatch?.[1] ?? new Date().toISOString(),
  };
}

export class NegativeKnowledgeStore {
  private entries: Map<string, NegativeKnowledgeEntry> = new Map();
  private dirtyIds: Set<string> = new Set();
  private readonly solutionsDir: string;
  private index: AIIndex | null = null;

  constructor(solutionsDir: string) {
    this.solutionsDir = solutionsDir;
  }

  initIndex(dbPath: string): void {
    this.index = new AIIndex(dbPath);
  }

  add(entry: Omit<NegativeKnowledgeEntry, 'id' | 'timestamp'>): NegativeKnowledgeEntry {
    const full: NegativeKnowledgeEntry = {
      ...entry,
      id: `nk_${Date.now()}_${randomUUID().replace(/-/g, '').substring(0, 8)}`,
      timestamp: new Date().toISOString(),
    };
    this.entries.set(full.id, full);
    this.dirtyIds.add(full.id);
    this.index?.index(full);
    return full;
  }

  get(id: string): NegativeKnowledgeEntry | undefined {
    return this.entries.get(id);
  }

  remove(id: string): boolean {
    const removed = this.entries.delete(id);
    if (removed) {
      this.dirtyIds.delete(id);
      this.index?.remove(id);
    }
    return removed;
  }

  update(id: string, updates: Partial<Omit<NegativeKnowledgeEntry, 'id' | 'timestamp'>>): NegativeKnowledgeEntry | undefined {
    const existing = this.entries.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.entries.set(id, updated);
    this.dirtyIds.add(id);
    this.index?.index(updated);
    return updated;
  }

  searchByKeyword(keyword: string): NegativeKnowledgeEntry[] {
    // Try FTS5 index first; fall back to linear scan if index not ready or returns empty
    if (this.index) {
      const results = this.index.search(keyword);
      if (results.length > 0) return results;
    }
    const lower = keyword.toLowerCase();
    return Array.from(this.entries.values()).filter(entry =>
      entry.scenario.toLowerCase().includes(lower) ||
      entry.attempt.toLowerCase().includes(lower) ||
      entry.outcome.toLowerCase().includes(lower) ||
      entry.solution.toLowerCase().includes(lower)
    );
  }

  searchByTags(tags: string[]): NegativeKnowledgeEntry[] {
    const lowerTags = tags.map(t => t.toLowerCase());
    return Array.from(this.entries.values()).filter(entry =>
      entry.tags.some(t => lowerTags.includes(t.toLowerCase()))
    );
  }

  getAll(): NegativeKnowledgeEntry[] {
    return Array.from(this.entries.values());
  }

  toMarkdown(entry: NegativeKnowledgeEntry): string {
    return [
      `# ${entry.scenario}`,
      '',
      `**ID:** ${entry.id}`,
      `**Date:** ${entry.timestamp}`,
      `**Tags:** ${entry.tags.join(', ')}`,
      '',
      '## Attempt',
      entry.attempt,
      '',
      '## Outcome',
      entry.outcome,
      '',
      '## Solution',
      entry.solution,
      '',
    ].join('\n');
  }

  saveToDisk(): void {
    if (!fs.existsSync(this.solutionsDir)) {
      fs.mkdirSync(this.solutionsDir, { recursive: true });
    }

    for (const id of this.dirtyIds) {
      const entry = this.entries.get(id);
      if (!entry) continue;

      const filename = `${entry.id}.md`;
      const filepath = path.join(this.solutionsDir, filename);
      fs.writeFileSync(filepath, this.toMarkdown(entry), 'utf-8');
    }

    this.dirtyIds.clear();
  }

  loadFromDisk(): void {
    if (!fs.existsSync(this.solutionsDir)) return;
    const files = fs.readdirSync(this.solutionsDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(this.solutionsDir, file), 'utf-8');
      const entry = parseNKMarkdown(content, file.replace('.md', ''));
      if (entry) {
        this.entries.set(entry.id, entry);
      }
    }

    // Re-index loaded entries if index is active.
    // Safe even if the index already has data: AIIndex.index() uses upsert
    // semantics (DELETE + INSERT in a transaction), so duplicates cannot occur.
    if (this.index) {
      for (const entry of this.entries.values()) {
        this.index.index(entry);
      }
    }
  }

  close(): void {
    if (this.index) {
      this.index.close();
      this.index = null;
    }
  }
}
