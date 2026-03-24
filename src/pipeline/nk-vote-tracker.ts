/**
 * NK Vote Tracker — core vote tracking for Negative Knowledge entries.
 *
 * Provides Wilson Score confidence intervals, context-key construction,
 * framework detection, and vote receipt creation/application.
 */

import * as fs from 'fs';
import * as path from 'path';
import { NegativeKnowledgeEntry, NegativeKnowledgeStore, VoteContext, VoteMetrics } from '../phase1/negative-knowledge';

export type { VoteMetrics, VoteContext } from '../phase1/negative-knowledge';

export interface VoteReceipt {
  nk_id: string;
  context_keys: string[];
  succeeded: boolean;
  timestamp: string;
}

// ── Constants ──────────────────────────────────────────────

export const FRAMEWORK_TAGS = new Set([
  'jest', 'typescript', 'react', 'node', 'webpack', 'prisma', 'docker', 'git',
  'eslint', 'api', 'auth', 'oauth', 'cors', 'websocket', 'database', 'migration',
  'cache', 'next', 'vue', 'svelte', 'express', 'fastify', 'django', 'rails',
]);

export const TIER_1_FRAMEWORKS = new Set([
  'next', 'react', 'vue', 'svelte', 'express', 'fastify', 'django', 'rails',
]);

export const TIER_2_INTEGRATIONS = new Set([
  'prisma', 'database', 'auth', 'oauth', 'websocket', 'docker', 'cache',
]);

// ── Functions ──────────────────────────────────────────────

/**
 * Build context keys from project frameworks and task tags.
 * Returns individual keys + optional compound key using tiering.
 */
export function buildContextKeys(projectFrameworks: string[], taskTags: string[]): string[] {
  // Merge, lowercase, filter empty, deduplicate
  const merged = [...projectFrameworks, ...taskTags]
    .map(t => t.toLowerCase())
    .filter(t => t.length > 0);

  const unique = [...new Set(merged)].sort();

  if (unique.length === 0) return ['_default'];

  const keys: string[] = [...unique];

  // Build compound key using tiering
  // tier1: max 1 from taskTags or projectFrameworks
  // tier2: from taskTags primarily
  const tier1Tags = unique.filter(t => TIER_1_FRAMEWORKS.has(t));
  const tier2Tags = taskTags.map(t => t.toLowerCase()).filter(t => TIER_2_INTEGRATIONS.has(t));

  const compoundTags = [...new Set([...tier1Tags, ...tier2Tags])].sort().slice(0, 4);

  if (compoundTags.length >= 2) {
    keys.push(compoundTags.join('+'));
  }

  return keys;
}

/**
 * Detect framework tags from a project's package.json.
 */
export function detectFrameworks(projectDir: string): string[] {
  try {
    const pkgPath = path.join(projectDir, 'package.json');
    const raw = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw);

    const allDeps: string[] = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ];

    // Strip scoped prefixes: @scope/name → name
    const names = allDeps.map(d => {
      const match = d.match(/^@[^/]+\/(.+)$/);
      return match ? match[1] : d;
    });

    return names
      .map(n => n.toLowerCase())
      .filter(n => FRAMEWORK_TAGS.has(n))
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Wilson Score Lower Bound — confidence interval for proportions.
 * Returns 0 if total === 0.
 */
export function wilsonScore(successes: number, total: number, z: number = 1.96): number {
  if (total === 0) return 0;

  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const centre = p + z2 / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);

  return (centre - spread) / denominator;
}

const MIN_ATTEMPTS_FOR_CONFIDENCE = 3;

/**
 * Resolve the Wilson score for an NK entry using a fallback chain:
 * compound key (>= 3 attempts) → best individual key (>= 3) → _default → 0
 */
export function resolveWilsonScore(entry: NegativeKnowledgeEntry, contextKeys: string[]): number {
  const metrics = entry.vote_metrics?.contexts;
  if (!metrics) return 0;

  // Try compound key first (contains "+")
  for (const key of contextKeys) {
    if (key.includes('+')) {
      const ctx = metrics[key];
      if (ctx && ctx.total_attempts >= MIN_ATTEMPTS_FOR_CONFIDENCE) {
        return wilsonScore(ctx.successes, ctx.total_attempts);
      }
    }
  }

  // Try best individual key (no "+", >= 3 attempts)
  let bestScore = -1;
  for (const key of contextKeys) {
    if (key.includes('+')) continue;
    const ctx = metrics[key];
    if (ctx && ctx.total_attempts >= MIN_ATTEMPTS_FOR_CONFIDENCE) {
      const score = wilsonScore(ctx.successes, ctx.total_attempts);
      if (score > bestScore) bestScore = score;
    }
  }
  if (bestScore >= 0) return bestScore;

  // Fallback to _default
  const defaultCtx = metrics['_default'];
  if (defaultCtx) {
    return wilsonScore(defaultCtx.successes, defaultCtx.total_attempts);
  }

  return 0;
}

/**
 * Increment votes on an NK entry. Pure function — does not mutate original.
 */
export function incrementVotes(
  entry: NegativeKnowledgeEntry,
  contextKeys: string[],
  succeeded: boolean,
): NegativeKnowledgeEntry {
  const src = entry;

  // Deep copy contexts
  const oldContexts = src.vote_metrics?.contexts ?? {};
  const newContexts: Record<string, VoteContext> = {};
  for (const [k, v] of Object.entries(oldContexts)) {
    newContexts[k] = { successes: v.successes, total_attempts: v.total_attempts };
  }

  // Increment each context key
  for (const key of contextKeys) {
    if (!newContexts[key]) {
      newContexts[key] = { successes: 0, total_attempts: 0 };
    }
    newContexts[key].total_attempts += 1;
    if (succeeded) {
      newContexts[key].successes += 1;
    }
  }

  return {
    ...entry,
    vote_metrics: { contexts: newContexts },
  };
}

/**
 * Create vote receipts for a set of NK entries.
 * Deduplicates by entry.id. Detects project frameworks to build context keys.
 */
export function createVoteReceipts(
  entries: NegativeKnowledgeEntry[],
  projectDir: string,
  succeeded: boolean,
): VoteReceipt[] {
  if (entries.length === 0) return [];

  const projectFrameworks = detectFrameworks(projectDir);
  const seen = new Set<string>();
  const receipts: VoteReceipt[] = [];

  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);

    // Filter entry tags to FRAMEWORK_TAGS-matching ones
    const entryFrameworkTags = entry.tags
      .map(t => t.toLowerCase())
      .filter(t => FRAMEWORK_TAGS.has(t));

    const contextKeys = buildContextKeys(projectFrameworks, entryFrameworkTags);

    receipts.push({
      nk_id: entry.id,
      context_keys: contextKeys,
      succeeded,
      timestamp: new Date().toISOString(),
    });
  }

  return receipts;
}

/**
 * Apply vote receipts to a NegativeKnowledgeStore.
 * Logs warnings for missing entries. Returns counts.
 */
export function applyVoteReceipts(
  store: NegativeKnowledgeStore,
  receipts: VoteReceipt[],
): { applied: number; skipped: number } {
  let applied = 0;
  let skipped = 0;

  for (const receipt of receipts) {
    const entry = store.get(receipt.nk_id);
    if (!entry) {
      console.warn(`[nk-vote-tracker] Entry not found for receipt: ${receipt.nk_id}`);
      skipped++;
      continue;
    }

    const updated = incrementVotes(entry, receipt.context_keys, receipt.succeeded);
    store.update(entry.id, { vote_metrics: updated.vote_metrics });
    applied++;
  }

  return { applied, skipped };
}
