/**
 * Phase 1: Negative Knowledge Store
 * Prevents agents from repeating known-failed approaches.
 * Stores structured entries in Scenario → Attempt → Solution format.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface NegativeKnowledgeEntry {
  id: string;
  scenario: string;
  attempt: string;
  outcome: string;
  solution: string;
  tags: string[];
  timestamp: string;
}

export class NegativeKnowledgeStore {
  private entries: Map<string, NegativeKnowledgeEntry> = new Map();
  private readonly solutionsDir: string;

  constructor(solutionsDir: string) {
    this.solutionsDir = solutionsDir;
  }

  add(entry: Omit<NegativeKnowledgeEntry, 'id' | 'timestamp'>): NegativeKnowledgeEntry {
    const full: NegativeKnowledgeEntry = {
      ...entry,
      id: `nk_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      timestamp: new Date().toISOString(),
    };
    this.entries.set(full.id, full);
    return full;
  }

  get(id: string): NegativeKnowledgeEntry | undefined {
    return this.entries.get(id);
  }

  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  update(id: string, updates: Partial<Omit<NegativeKnowledgeEntry, 'id' | 'timestamp'>>): NegativeKnowledgeEntry | undefined {
    const existing = this.entries.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.entries.set(id, updated);
    return updated;
  }

  searchByKeyword(keyword: string): NegativeKnowledgeEntry[] {
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
    for (const entry of this.entries.values()) {
      const filename = `${entry.id}.md`;
      const filepath = path.join(this.solutionsDir, filename);
      fs.writeFileSync(filepath, this.toMarkdown(entry), 'utf-8');
    }
  }

  loadFromDisk(): void {
    if (!fs.existsSync(this.solutionsDir)) return;
    const files = fs.readdirSync(this.solutionsDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(this.solutionsDir, file), 'utf-8');
      const entry = this.parseMarkdown(content, file.replace('.md', ''));
      if (entry) {
        this.entries.set(entry.id, entry);
      }
    }
  }

  private parseMarkdown(content: string, fallbackId: string): NegativeKnowledgeEntry | null {
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
}
