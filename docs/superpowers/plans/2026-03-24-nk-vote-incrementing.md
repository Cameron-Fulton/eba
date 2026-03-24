# NK Vote Incrementing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the NK feedback loop by tracking which promoted entries help solve tasks and incrementing context-scoped vote metrics on them.

**Architecture:** Lock-free vote receipts attached to memory packets; Merge Agent applies votes under lockfile. New `nk-vote-tracker.ts` module owns all vote logic. PromptEnhancer tracks injected NK entries; pipeline builds receipts post-task.

**Tech Stack:** TypeScript, Jest 29 (ts-jest), SQLite (better-sqlite3 for NK index)

**Spec:** `docs/superpowers/specs/2026-03-24-nk-vote-incrementing-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/pipeline/nk-vote-tracker.ts` | CREATE | Vote constants, key construction, Wilson score + fallback, detectFrameworks, incrementVotes, createVoteReceipts, applyVoteReceipts. **NOTE:** `VoteMetrics`, `VoteContext` types are defined in `negative-knowledge.ts` (avoids circular import since nk-vote-tracker imports NegativeKnowledgeEntry). `VoteReceipt` is defined here (memory-packet imports it one-way). |
| `tests/pipeline/nk-vote-tracker.test.ts` | CREATE | Tests for all nk-vote-tracker exports |
| `src/phase1/negative-knowledge.ts` | MODIFY | Define `VoteMetrics`/`VoteContext` types, add `vote_metrics?` to entry, update toMarkdown/parseNKMarkdown |
| `tests/phase1/negative-knowledge.test.ts` | MODIFY | Add vote_metrics serialization tests |
| `src/phase1/memory-packet.ts` | MODIFY | Add `vote_receipts?` to MemoryPacket, update validation |
| `tests/phase1/memory-packet.test.ts` | MODIFY | Add vote_receipts validation tests |
| `src/pipeline/prompt-enhancer.ts` | MODIFY | Track injected NK entries, expose getter/clear |
| `tests/pipeline/prompt-enhancer.test.ts` | MODIFY | Add injection tracking tests |
| `src/pipeline/nk-promoter.ts` | MODIFY | Import FRAMEWORK_TAGS from nk-vote-tracker, remove `votes:0` tag, init vote_metrics |
| `tests/pipeline/nk-promoter.test.ts` | MODIFY | Update tag expectations, add vote_metrics init tests |
| `src/pipeline/eba-pipeline.ts` | MODIFY | Build vote receipts post-task, attach to memory packet |
| `tests/pipeline/eba-pipeline.integration.test.ts` | MODIFY | Add vote receipt attachment test |
| `src/pipeline/merge-agent.ts` | MODIFY | sweep() processes receipts before merge, mergePackets() unions receipts |
| `tests/pipeline/merge-agent.test.ts` | MODIFY | Add vote receipt processing/stripping tests |

---

### Task 1: Core Types and Constants (`nk-vote-tracker.ts`)

**Files:**
- Create: `src/pipeline/nk-vote-tracker.ts`
- Create: `tests/pipeline/nk-vote-tracker.test.ts`

- [ ] **Step 1: Write failing tests for types and buildContextKeys**

```typescript
// tests/pipeline/nk-vote-tracker.test.ts
import {
  buildContextKeys,
  TIER_1_FRAMEWORKS,
  TIER_2_INTEGRATIONS,
  FRAMEWORK_TAGS,
} from '../../src/pipeline/nk-vote-tracker';

describe('nk-vote-tracker', () => {
  describe('buildContextKeys', () => {
    it('returns _default when no tags provided', () => {
      expect(buildContextKeys([], [])).toEqual(['_default']);
    });

    it('returns individual keys for single tags', () => {
      const keys = buildContextKeys(['next'], []);
      expect(keys).toContain('next');
      expect(keys).not.toContain('_default');
    });

    it('builds compound key from tier1 + tier2 tags', () => {
      const keys = buildContextKeys(['next'], ['prisma']);
      expect(keys).toContain('next');
      expect(keys).toContain('prisma');
      expect(keys).toContain('next+prisma');
    });

    it('never includes tier3 tags in compound key', () => {
      const keys = buildContextKeys(['next', 'jest', 'typescript'], ['prisma']);
      // Compound should be next+prisma, NOT jest+next+prisma+typescript
      expect(keys).toContain('next+prisma');
      expect(keys).not.toContain(expect.stringContaining('jest+'));
      expect(keys).not.toContain(expect.stringContaining('typescript'));
      // But individual keys include everything
      expect(keys).toContain('jest');
      expect(keys).toContain('typescript');
    });

    it('filters empty strings', () => {
      const keys = buildContextKeys(['', 'next'], ['']);
      expect(keys).not.toContain('');
      expect(keys).toContain('next');
    });

    it('deduplicates tags', () => {
      const keys = buildContextKeys(['next', 'next'], ['next']);
      const nextCount = keys.filter(k => k === 'next').length;
      expect(nextCount).toBe(1);
    });

    it('sorts compound key alphabetically', () => {
      const keys = buildContextKeys(['react'], ['prisma', 'auth']);
      const compound = keys.find(k => k.includes('+'));
      expect(compound).toBe('auth+prisma+react');
    });

    it('caps compound key at 4 tags', () => {
      const keys = buildContextKeys(
        ['next'],
        ['prisma', 'auth', 'oauth', 'database', 'cache']
      );
      const compound = keys.find(k => k.includes('+'));
      if (compound) {
        expect(compound.split('+').length).toBeLessThanOrEqual(4);
      }
    });

    it('requires 2+ tags for compound key', () => {
      const keys = buildContextKeys(['next'], []);
      const hasCompound = keys.some(k => k.includes('+'));
      expect(hasCompound).toBe(false);
    });
  });

  describe('constants', () => {
    it('FRAMEWORK_TAGS is a Set with expected members', () => {
      expect(FRAMEWORK_TAGS).toBeInstanceOf(Set);
      expect(FRAMEWORK_TAGS.has('jest')).toBe(true);
      expect(FRAMEWORK_TAGS.has('typescript')).toBe(true);
    });

    it('TIER_1_FRAMEWORKS is a subset of FRAMEWORK_TAGS', () => {
      for (const t of TIER_1_FRAMEWORKS) {
        expect(FRAMEWORK_TAGS.has(t)).toBe(true);
      }
    });

    it('TIER_2_INTEGRATIONS is a subset of FRAMEWORK_TAGS', () => {
      for (const t of TIER_2_INTEGRATIONS) {
        expect(FRAMEWORK_TAGS.has(t)).toBe(true);
      }
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/pipeline/nk-vote-tracker.test.ts --runInBand --forceExit`
Expected: FAIL — module not found

- [ ] **Step 3: Implement types, constants, and buildContextKeys**

**CIRCULAR IMPORT PREVENTION:** `VoteMetrics` and `VoteContext` are defined in `negative-knowledge.ts` (Task 5) since that's where `NegativeKnowledgeEntry` lives. `nk-vote-tracker.ts` re-exports them. For Task 1, we define placeholder types that will be replaced by re-exports in Task 5. `VoteReceipt` stays here since `memory-packet.ts` imports it one-way.

```typescript
// src/pipeline/nk-vote-tracker.ts

// These will be replaced by re-exports from negative-knowledge.ts in Task 5.
// For now, define locally so Tasks 1-4 compile independently.
export interface VoteContext {
  successes: number;
  total_attempts: number;
}

export interface VoteMetrics {
  contexts: Record<string, VoteContext>;
}

export interface VoteReceipt {
  nk_id: string;
  context_keys: string[];
  succeeded: boolean;
  timestamp: string;
}

export const FRAMEWORK_TAGS = new Set([
  'jest', 'typescript', 'react', 'node', 'webpack', 'prisma', 'docker',
  'git', 'eslint', 'api', 'auth', 'oauth', 'cors', 'websocket',
  'database', 'migration', 'cache',
  'next', 'vue', 'svelte', 'express', 'fastify', 'django', 'rails',
]);

export const TIER_1_FRAMEWORKS = new Set([
  'next', 'react', 'vue', 'svelte', 'express', 'fastify', 'django', 'rails',
]);

export const TIER_2_INTEGRATIONS = new Set([
  'prisma', 'database', 'auth', 'oauth', 'websocket', 'docker', 'cache',
]);

export function buildContextKeys(
  projectFrameworks: string[],
  taskTags: string[],
): string[] {
  const all = [...new Set([...projectFrameworks, ...taskTags])]
    .map(t => t.toLowerCase())
    .filter(t => t.length > 0)
    .sort();

  if (all.length === 0) return ['_default'];

  const keys: string[] = [...all];

  // Compound key — always tiered, never ambient noise
  const tier1 = all.filter(t => TIER_1_FRAMEWORKS.has(t)).slice(0, 1);
  const tier2Task = taskTags
    .map(t => t.toLowerCase())
    .filter(t => TIER_2_INTEGRATIONS.has(t));
  const compoundTags = [...new Set([...tier1, ...tier2Task])]
    .sort()
    .slice(0, 4);

  if (compoundTags.length >= 2) {
    keys.push(compoundTags.join('+'));
  }

  return keys;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/pipeline/nk-vote-tracker.test.ts --runInBand --forceExit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/nk-vote-tracker.ts tests/pipeline/nk-vote-tracker.test.ts
git commit -m "feat(nk-vote): core types, constants, and buildContextKeys"
```

---

### Task 2: detectFrameworks and Wilson Score

**Files:**
- Modify: `src/pipeline/nk-vote-tracker.ts`
- Modify: `tests/pipeline/nk-vote-tracker.test.ts`

- [ ] **Step 1: Write failing tests for detectFrameworks and wilsonScore**

```typescript
// Add to tests/pipeline/nk-vote-tracker.test.ts
import {
  detectFrameworks,
  wilsonScore,
} from '../../src/pipeline/nk-vote-tracker';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('detectFrameworks', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nk-vote-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when no package.json exists', () => {
    expect(detectFrameworks(tmpDir)).toEqual([]);
  });

  it('detects frameworks from dependencies', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { 'next': '^14.0.0', 'lodash': '^4.0.0' },
      devDependencies: { 'jest': '^29.0.0', 'prettier': '^3.0.0' },
    }));
    const result = detectFrameworks(tmpDir);
    expect(result).toContain('next');
    expect(result).toContain('jest');
    expect(result).not.toContain('lodash');
    expect(result).not.toContain('prettier');
  });

  it('strips scoped package prefixes', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { '@prisma/client': '^5.0.0' },
    }));
    // Note: 'client' is not in FRAMEWORK_TAGS, so won't match.
    // This tests the stripping logic itself.
    const result = detectFrameworks(tmpDir);
    expect(result).not.toContain('@prisma/client');
  });

  it('returns empty on malformed package.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), 'not json');
    expect(detectFrameworks(tmpDir)).toEqual([]);
  });
});

describe('wilsonScore', () => {
  it('returns 0 for zero total attempts', () => {
    expect(wilsonScore(0, 0)).toBe(0);
  });

  it('returns positive value for all successes', () => {
    const score = wilsonScore(10, 10);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('returns 0 for zero successes', () => {
    const score = wilsonScore(0, 10);
    expect(score).toBe(0);
  });

  it('higher success rate produces higher score', () => {
    const high = wilsonScore(9, 10);
    const low = wilsonScore(5, 10);
    expect(high).toBeGreaterThan(low);
  });

  it('more data produces tighter bound (higher lower bound)', () => {
    // 90% success rate, but more data should give higher lower bound
    const small = wilsonScore(9, 10);
    const large = wilsonScore(90, 100);
    expect(large).toBeGreaterThan(small);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/pipeline/nk-vote-tracker.test.ts --runInBand --forceExit`
Expected: FAIL — detectFrameworks and wilsonScore not exported

- [ ] **Step 3: Implement detectFrameworks and wilsonScore**

Add to `src/pipeline/nk-vote-tracker.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';

export function detectFrameworks(projectDir: string): string[] {
  const pkgPath = path.join(projectDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
    return Object.keys(allDeps)
      .map(d => d.toLowerCase().replace(/^@[^/]+\//, ''))
      .filter(d => FRAMEWORK_TAGS.has(d));
  } catch { return []; }
}

export function wilsonScore(successes: number, total: number, z = 1.96): number {
  if (total === 0) return 0;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return (center - spread) / denominator;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/pipeline/nk-vote-tracker.test.ts --runInBand --forceExit`
Expected: PASS

- [ ] **Step 5: Write failing tests for resolveWilsonScore fallback chain**

```typescript
// Add to tests/pipeline/nk-vote-tracker.test.ts
import { resolveWilsonScore } from '../../src/pipeline/nk-vote-tracker';
import { NegativeKnowledgeEntry } from '../../src/phase1/negative-knowledge';

// Inline helper — Task 3 will define a shared makeEntry, but Task 2 needs it now.
// This local version is sufficient for resolveWilsonScore tests.
const makeEntryForScore = (overrides: Partial<NegativeKnowledgeEntry> = {}): NegativeKnowledgeEntry => ({
  id: 'nk_score_test',
  scenario: 'test',
  attempt: 'test',
  outcome: 'test',
  solution: 'test',
  tags: [],
  timestamp: new Date().toISOString(),
  ...overrides,
});

describe('resolveWilsonScore', () => {
  it('uses compound key when total_attempts >= 3', () => {
    const entry = makeEntryForScore({
      vote_metrics: {
        contexts: {
          'next+prisma': { successes: 8, total_attempts: 10 },
          'next': { successes: 5, total_attempts: 10 },
        },
      },
    });
    const score = resolveWilsonScore(entry, ['next', 'prisma', 'next+prisma']);
    const compoundScore = wilsonScore(8, 10);
    expect(score).toBeCloseTo(compoundScore, 5);
  });

  it('falls back to best individual key when compound has < 3 attempts', () => {
    const entry = makeEntryForScore({
      vote_metrics: {
        contexts: {
          'next+prisma': { successes: 1, total_attempts: 2 },
          'next': { successes: 7, total_attempts: 10 },
          'prisma': { successes: 3, total_attempts: 5 },
        },
      },
    });
    const score = resolveWilsonScore(entry, ['next', 'prisma', 'next+prisma']);
    const nextScore = wilsonScore(7, 10);
    expect(score).toBeCloseTo(nextScore, 5);
  });

  it('falls back to _default when no key qualifies', () => {
    const entry = makeEntryForScore({
      vote_metrics: {
        contexts: {
          '_default': { successes: 3, total_attempts: 5 },
        },
      },
    });
    const score = resolveWilsonScore(entry, ['jest']);
    const defaultScore = wilsonScore(3, 5);
    expect(score).toBeCloseTo(defaultScore, 5);
  });

  it('returns 0 for entry with no vote_metrics', () => {
    const entry = makeEntryForScore();
    expect(resolveWilsonScore(entry, ['jest'])).toBe(0);
  });

  it('returns 0 for entry with empty contexts', () => {
    const entry = makeEntryForScore({ vote_metrics: { contexts: {} } });
    expect(resolveWilsonScore(entry, ['jest'])).toBe(0);
  });
});
```

- [ ] **Step 6: Implement resolveWilsonScore**

Add to `src/pipeline/nk-vote-tracker.ts`:

```typescript
const MIN_ATTEMPTS_FOR_CONFIDENCE = 3;

export function resolveWilsonScore(
  entry: NegativeKnowledgeEntry,
  contextKeys: string[],
): number {
  const contexts = entry.vote_metrics?.contexts;
  if (!contexts || Object.keys(contexts).length === 0) return 0;

  // 1. Try compound key (any key with '+')
  const compoundKey = contextKeys.find(k => k.includes('+'));
  if (compoundKey && contexts[compoundKey]) {
    const ctx = contexts[compoundKey];
    if (ctx.total_attempts >= MIN_ATTEMPTS_FOR_CONFIDENCE) {
      return wilsonScore(ctx.successes, ctx.total_attempts);
    }
  }

  // 2. Best individual key with sufficient data
  let bestScore = -1;
  for (const key of contextKeys) {
    if (key.includes('+')) continue; // skip compound
    const ctx = contexts[key];
    if (ctx && ctx.total_attempts >= MIN_ATTEMPTS_FOR_CONFIDENCE) {
      const score = wilsonScore(ctx.successes, ctx.total_attempts);
      if (score > bestScore) bestScore = score;
    }
  }
  if (bestScore >= 0) return bestScore;

  // 3. _default fallback
  const defaultCtx = contexts['_default'];
  if (defaultCtx && defaultCtx.total_attempts > 0) {
    return wilsonScore(defaultCtx.successes, defaultCtx.total_attempts);
  }

  // 4. Truly unknown
  return 0;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx jest tests/pipeline/nk-vote-tracker.test.ts --runInBand --forceExit`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/pipeline/nk-vote-tracker.ts tests/pipeline/nk-vote-tracker.test.ts
git commit -m "feat(nk-vote): detectFrameworks, Wilson Score, and resolveWilsonScore fallback"
```

---

### Task 3: incrementVotes and createVoteReceipts

**Files:**
- Modify: `src/pipeline/nk-vote-tracker.ts`
- Modify: `tests/pipeline/nk-vote-tracker.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// Add to tests/pipeline/nk-vote-tracker.test.ts
import {
  incrementVotes,
  createVoteReceipts,
} from '../../src/pipeline/nk-vote-tracker';
import { NegativeKnowledgeEntry } from '../../src/phase1/negative-knowledge';

const makeEntry = (overrides: Partial<NegativeKnowledgeEntry> = {}): NegativeKnowledgeEntry => ({
  id: 'nk_test_001',
  scenario: 'test scenario',
  attempt: 'test attempt',
  outcome: 'test outcome',
  solution: 'test solution',
  tags: ['jest', 'typescript'],
  timestamp: new Date().toISOString(),
  ...overrides,
});

describe('incrementVotes', () => {
  it('initializes vote_metrics when undefined', () => {
    const entry = makeEntry();
    const result = incrementVotes(entry, ['jest', 'typescript'], true);
    expect(result.vote_metrics).toBeDefined();
    expect(result.vote_metrics!.contexts['jest']).toEqual({ successes: 1, total_attempts: 1 });
    expect(result.vote_metrics!.contexts['typescript']).toEqual({ successes: 1, total_attempts: 1 });
  });

  it('increments existing context', () => {
    const entry = makeEntry({
      vote_metrics: {
        contexts: { jest: { successes: 2, total_attempts: 3 } },
      },
    });
    const result = incrementVotes(entry, ['jest'], true);
    expect(result.vote_metrics!.contexts['jest']).toEqual({ successes: 3, total_attempts: 4 });
  });

  it('increments total_attempts only on failure', () => {
    const entry = makeEntry({
      vote_metrics: {
        contexts: { jest: { successes: 2, total_attempts: 3 } },
      },
    });
    const result = incrementVotes(entry, ['jest'], false);
    expect(result.vote_metrics!.contexts['jest']).toEqual({ successes: 2, total_attempts: 4 });
  });

  it('does not mutate original entry', () => {
    const entry = makeEntry({
      vote_metrics: {
        contexts: { jest: { successes: 1, total_attempts: 1 } },
      },
    });
    incrementVotes(entry, ['jest'], true);
    expect(entry.vote_metrics!.contexts['jest']).toEqual({ successes: 1, total_attempts: 1 });
  });
});

describe('createVoteReceipts', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nk-vote-'));
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { next: '^14.0.0' },
      devDependencies: { jest: '^29.0.0' },
    }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array for empty entries', () => {
    expect(createVoteReceipts([], tmpDir, true)).toEqual([]);
  });

  it('creates receipt with correct context keys', () => {
    const entries = [makeEntry({ tags: ['jest', 'prisma'] })];
    const receipts = createVoteReceipts(entries, tmpDir, true);
    expect(receipts).toHaveLength(1);
    expect(receipts[0].nk_id).toBe('nk_test_001');
    expect(receipts[0].succeeded).toBe(true);
    expect(receipts[0].context_keys).toContain('jest');
    expect(receipts[0].context_keys).toContain('next'); // from project
    expect(receipts[0].context_keys).toContain('prisma');
  });

  it('deduplicates entries by id', () => {
    const entry = makeEntry();
    const receipts = createVoteReceipts([entry, entry, entry], tmpDir, false);
    expect(receipts).toHaveLength(1);
  });

  it('falls back to _default when no frameworks detected', () => {
    const noFwDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nk-vote-'));
    const entry = makeEntry({ tags: ['auto-recorded'] });
    const receipts = createVoteReceipts([entry], noFwDir, true);
    expect(receipts[0].context_keys).toEqual(['_default']);
    fs.rmSync(noFwDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/pipeline/nk-vote-tracker.test.ts --runInBand --forceExit`
Expected: FAIL — incrementVotes and createVoteReceipts not exported

- [ ] **Step 3: Implement incrementVotes and createVoteReceipts**

Add to `src/pipeline/nk-vote-tracker.ts`:

```typescript
import { NegativeKnowledgeEntry } from '../phase1/negative-knowledge';

export function incrementVotes(
  entry: NegativeKnowledgeEntry,
  contextKeys: string[],
  succeeded: boolean,
): NegativeKnowledgeEntry {
  const existing = entry.vote_metrics ?? { contexts: {} };
  const contexts: Record<string, VoteContext> = {};

  // Deep copy existing contexts
  for (const [key, ctx] of Object.entries(existing.contexts)) {
    contexts[key] = { ...ctx };
  }

  // Increment each context key
  for (const key of contextKeys) {
    if (!contexts[key]) {
      contexts[key] = { successes: 0, total_attempts: 0 };
    }
    contexts[key].total_attempts += 1;
    if (succeeded) {
      contexts[key].successes += 1;
    }
  }

  return {
    ...entry,
    vote_metrics: { contexts },
  };
}

export function createVoteReceipts(
  entries: NegativeKnowledgeEntry[],
  projectDir: string,
  succeeded: boolean,
): VoteReceipt[] {
  if (entries.length === 0) return [];

  const projectFrameworks = detectFrameworks(projectDir);

  // Deduplicate by entry id
  const seen = new Set<string>();
  const receipts: VoteReceipt[] = [];

  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);

    const taskTags = entry.tags
      .map(t => t.toLowerCase())
      .filter(t => FRAMEWORK_TAGS.has(t));

    const contextKeys = buildContextKeys(projectFrameworks, taskTags);

    receipts.push({
      nk_id: entry.id,
      context_keys: contextKeys,
      succeeded,
      timestamp: new Date().toISOString(),
    });
  }

  return receipts;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/pipeline/nk-vote-tracker.test.ts --runInBand --forceExit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/nk-vote-tracker.ts tests/pipeline/nk-vote-tracker.test.ts
git commit -m "feat(nk-vote): incrementVotes and createVoteReceipts"
```

---

### Task 4: applyVoteReceipts (for Merge Agent)

**Files:**
- Modify: `src/pipeline/nk-vote-tracker.ts`
- Modify: `tests/pipeline/nk-vote-tracker.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// Add to tests/pipeline/nk-vote-tracker.test.ts
import { applyVoteReceipts } from '../../src/pipeline/nk-vote-tracker';
import { NegativeKnowledgeStore } from '../../src/phase1/negative-knowledge';

describe('applyVoteReceipts', () => {
  let store: NegativeKnowledgeStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nk-store-'));
    store = new NegativeKnowledgeStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('increments votes on existing entries', () => {
    const entry = store.add({
      scenario: 'test', attempt: 'a', outcome: 'o', solution: 's',
      tags: ['jest'],
    });
    const receipts: VoteReceipt[] = [{
      nk_id: entry.id,
      context_keys: ['jest'],
      succeeded: true,
      timestamp: new Date().toISOString(),
    }];
    const { applied, skipped } = applyVoteReceipts(store, receipts);
    expect(applied).toBe(1);
    expect(skipped).toBe(0);
    const updated = store.get(entry.id)!;
    expect(updated.vote_metrics!.contexts['jest']).toEqual({
      successes: 1, total_attempts: 1,
    });
  });

  it('skips receipts for missing entries with warning', () => {
    const receipts: VoteReceipt[] = [{
      nk_id: 'nk_nonexistent',
      context_keys: ['jest'],
      succeeded: true,
      timestamp: new Date().toISOString(),
    }];
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const { applied, skipped } = applyVoteReceipts(store, receipts);
    expect(applied).toBe(0);
    expect(skipped).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('nk_nonexistent')
    );
    warnSpy.mockRestore();
  });

  it('handles empty receipts array', () => {
    const { applied, skipped } = applyVoteReceipts(store, []);
    expect(applied).toBe(0);
    expect(skipped).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/pipeline/nk-vote-tracker.test.ts --runInBand --forceExit`
Expected: FAIL — applyVoteReceipts not exported

- [ ] **Step 3: Implement applyVoteReceipts**

Add to `src/pipeline/nk-vote-tracker.ts`:

```typescript
import { NegativeKnowledgeStore } from '../phase1/negative-knowledge';

export function applyVoteReceipts(
  store: NegativeKnowledgeStore,
  receipts: VoteReceipt[],
): { applied: number; skipped: number } {
  let applied = 0;
  let skipped = 0;

  for (const receipt of receipts) {
    const entry = store.get(receipt.nk_id);
    if (!entry) {
      console.warn(`Vote receipt skipped: NK entry ${receipt.nk_id} not found in store`);
      skipped++;
      continue;
    }

    const updated = incrementVotes(entry, receipt.context_keys, receipt.succeeded);
    store.update(entry.id, { vote_metrics: updated.vote_metrics });
    applied++;
  }

  return { applied, skipped };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/pipeline/nk-vote-tracker.test.ts --runInBand --forceExit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/nk-vote-tracker.ts tests/pipeline/nk-vote-tracker.test.ts
git commit -m "feat(nk-vote): applyVoteReceipts for merge agent"
```

---

### Task 5: NegativeKnowledgeEntry schema + markdown serialization

**Files:**
- Modify: `src/phase1/negative-knowledge.ts`
- Modify: `tests/phase1/negative-knowledge.test.ts`

- [ ] **Step 1: Write failing tests for vote_metrics in markdown round-trip**

```typescript
// Add to tests/phase1/negative-knowledge.test.ts
describe('vote_metrics markdown serialization', () => {
  it('toMarkdown includes Vote Metrics line', () => {
    const store = new NegativeKnowledgeStore(tmpDir);
    const entry = store.add({
      scenario: 'test', attempt: 'a', outcome: 'o', solution: 's',
      tags: ['jest'],
    });
    // Manually set vote_metrics
    store.update(entry.id, {
      vote_metrics: {
        contexts: {
          jest: { successes: 2, total_attempts: 3 },
          _default: { successes: 0, total_attempts: 0 },
        },
      },
    });
    const md = store.toMarkdown(store.get(entry.id)!);
    expect(md).toContain('**Vote Metrics:** ');
    expect(md).toContain('jest: 2/3');
    expect(md).toContain('_default: 0/0');
  });

  it('toMarkdown omits Vote Metrics line when undefined', () => {
    const store = new NegativeKnowledgeStore(tmpDir);
    const entry = store.add({
      scenario: 'test', attempt: 'a', outcome: 'o', solution: 's',
      tags: ['jest'],
    });
    const md = store.toMarkdown(store.get(entry.id)!);
    expect(md).not.toContain('**Vote Metrics:**');
  });

  it('parseNKMarkdown reads vote_metrics from markdown', () => {
    const md = [
      '# Test scenario',
      '',
      '**ID:** nk_test_001',
      '**Date:** 2026-03-24T00:00:00.000Z',
      '**Tags:** jest, typescript',
      '**Vote Metrics:** jest: 2/3, typescript: 1/2',
      '',
      '## Attempt',
      'tried something',
      '',
      '## Outcome',
      'it failed',
      '',
      '## Solution',
      'do this instead',
      '',
    ].join('\n');
    const entry = parseNKMarkdown(md, 'fallback');
    expect(entry).not.toBeNull();
    expect(entry!.vote_metrics).toEqual({
      contexts: {
        jest: { successes: 2, total_attempts: 3 },
        typescript: { successes: 1, total_attempts: 2 },
      },
    });
  });

  it('parseNKMarkdown returns undefined vote_metrics when line missing', () => {
    const md = [
      '# Test scenario',
      '',
      '**ID:** nk_test_002',
      '**Date:** 2026-03-24T00:00:00.000Z',
      '**Tags:** jest',
      '',
      '## Attempt',
      'tried',
      '',
      '## Outcome',
      'failed',
      '',
      '## Solution',
      'fix',
      '',
    ].join('\n');
    const entry = parseNKMarkdown(md, 'fallback');
    expect(entry!.vote_metrics).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/phase1/negative-knowledge.test.ts --runInBand --forceExit`
Expected: FAIL — vote_metrics not on interface / toMarkdown doesn't emit it

- [ ] **Step 3: Define VoteMetrics/VoteContext in negative-knowledge.ts and add to entry**

In `src/phase1/negative-knowledge.ts`, add the types and field. These types live here (not in nk-vote-tracker) to avoid a circular import — nk-vote-tracker imports NegativeKnowledgeEntry, so negative-knowledge.ts must not import from nk-vote-tracker.

```typescript
// Add ABOVE the NegativeKnowledgeEntry interface in negative-knowledge.ts
export interface VoteContext {
  successes: number;
  total_attempts: number;
}

export interface VoteMetrics {
  contexts: Record<string, VoteContext>;
}

export interface NegativeKnowledgeEntry {
  id: string;
  scenario: string;
  attempt: string;
  outcome: string;
  solution: string;
  tags: string[];
  timestamp: string;
  vote_metrics?: VoteMetrics;
}
```

- [ ] **Step 3b: Update nk-vote-tracker.ts to re-export instead of define**

In `src/pipeline/nk-vote-tracker.ts`, replace the local `VoteMetrics` and `VoteContext` interface definitions with re-exports:

```typescript
// Replace the local VoteContext/VoteMetrics interfaces with:
export { VoteMetrics, VoteContext } from '../phase1/negative-knowledge';
```

This ensures nk-vote-tracker consumers still import from the same place, while the canonical definition lives in negative-knowledge.ts. No circular import: negative-knowledge.ts defines types, nk-vote-tracker.ts imports NegativeKnowledgeEntry + re-exports VoteMetrics/VoteContext.

- [ ] **Step 4: Update toMarkdown to emit Vote Metrics line**

In `toMarkdown()`, after the Tags line, add:

```typescript
toMarkdown(entry: NegativeKnowledgeEntry): string {
  const lines = [
    `# ${entry.scenario}`,
    '',
    `**ID:** ${entry.id}`,
    `**Date:** ${entry.timestamp}`,
    `**Tags:** ${entry.tags.join(', ')}`,
  ];

  if (entry.vote_metrics) {
    const parts = Object.entries(entry.vote_metrics.contexts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, ctx]) => `${key}: ${ctx.successes}/${ctx.total_attempts}`);
    lines.push(`**Vote Metrics:** ${parts.join(', ')}`);
  }

  lines.push('', '## Attempt', entry.attempt, '', '## Outcome', entry.outcome, '', '## Solution', entry.solution, '');
  return lines.join('\n');
}
```

- [ ] **Step 5: Update parseNKMarkdown to read Vote Metrics**

```typescript
export function parseNKMarkdown(content: string, fallbackId: string): NegativeKnowledgeEntry | null {
  // ... existing parsing ...

  const voteMatch = content.match(/\*\*Vote Metrics:\*\* (.+)/);
  let vote_metrics: VoteMetrics | undefined;
  if (voteMatch) {
    const contexts: Record<string, { successes: number; total_attempts: number }> = {};
    const pairs = voteMatch[1].split(', ');
    for (const pair of pairs) {
      const m = pair.match(/^(.+): (\d+)\/(\d+)$/);
      if (m) {
        contexts[m[1]] = { successes: parseInt(m[2], 10), total_attempts: parseInt(m[3], 10) };
      }
    }
    if (Object.keys(contexts).length > 0) {
      vote_metrics = { contexts };
    }
  }

  return {
    id: idMatch?.[1] ?? fallbackId,
    scenario: scenarioMatch[1],
    attempt,
    outcome,
    solution,
    tags: tagsMatch?.[1]?.split(', ').filter(Boolean) ?? [],
    timestamp: dateMatch?.[1] ?? new Date().toISOString(),
    vote_metrics,
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest tests/phase1/negative-knowledge.test.ts --runInBand --forceExit`
Expected: PASS

- [ ] **Step 7: Run full test suite to check for regressions**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add src/phase1/negative-knowledge.ts tests/phase1/negative-knowledge.test.ts
git commit -m "feat(nk-vote): vote_metrics on NegativeKnowledgeEntry + markdown serialization"
```

---

### Task 6: MemoryPacket vote_receipts field + validation

**Files:**
- Modify: `src/phase1/memory-packet.ts`
- Modify: `tests/phase1/memory-packet.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// Add to tests/phase1/memory-packet.test.ts
describe('vote_receipts validation', () => {
  it('accepts packet with valid vote_receipts array', () => {
    const packet = createValidPacket();
    packet.vote_receipts = [{
      nk_id: 'nk_001', context_keys: ['jest'], succeeded: true, timestamp: '2026-03-24',
    }];
    const { valid } = validateMemoryPacket(packet);
    expect(valid).toBe(true);
  });

  it('accepts packet without vote_receipts', () => {
    const packet = createValidPacket();
    const { valid } = validateMemoryPacket(packet);
    expect(valid).toBe(true);
  });

  it('rejects non-array vote_receipts', () => {
    const packet = createValidPacket();
    (packet as any).vote_receipts = 'not an array';
    const { valid, errors } = validateMemoryPacket(packet);
    expect(valid).toBe(false);
    expect(errors).toContain('vote_receipts must be an array when present');
  });

  it('serializes and deserializes packet with vote_receipts', () => {
    const packet = createValidPacket();
    packet.vote_receipts = [{
      nk_id: 'nk_001', context_keys: ['jest'], succeeded: true, timestamp: '2026-03-24',
    }];
    const json = serializePacket(packet);
    const restored = deserializePacket(json);
    expect(restored.vote_receipts).toEqual(packet.vote_receipts);
  });
});
```

Note: `createValidPacket()` should be a helper already in the test file (or create one that builds a minimal valid MemoryPacket). Check existing test file for the exact helper name.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/phase1/memory-packet.test.ts --runInBand --forceExit`
Expected: FAIL — vote_receipts not on interface

- [ ] **Step 3: Add vote_receipts to MemoryPacket**

In `src/phase1/memory-packet.ts`:

```typescript
import { VoteReceipt } from '../pipeline/nk-vote-tracker';

export interface MemoryPacket {
  // ... existing fields ...
  vote_receipts?: VoteReceipt[];
}
```

Add validation in `validateMemoryPacket()` after the `session_meta` check:

```typescript
if (p.vote_receipts !== undefined) {
  if (!Array.isArray(p.vote_receipts)) {
    errors.push('vote_receipts must be an array when present');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/phase1/memory-packet.test.ts --runInBand --forceExit`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/phase1/memory-packet.ts tests/phase1/memory-packet.test.ts
git commit -m "feat(nk-vote): vote_receipts on MemoryPacket + validation"
```

---

### Task 7: PromptEnhancer injection tracking

**Files:**
- Modify: `src/pipeline/prompt-enhancer.ts`
- Modify: `tests/pipeline/prompt-enhancer.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// Add to tests/pipeline/prompt-enhancer.test.ts
import * as os from 'os';

describe('NK injection tracking', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-nk-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('tracks injected NK entries', () => {
    // Set up a PromptEnhancer with a real NK store containing entries
    // whose keywords will match the prompt
    const nkStore = new NegativeKnowledgeStore(tmpDir);
    const entry = nkStore.add({
      scenario: 'deploy failure on NTFS',
      attempt: 'used symlinks',
      outcome: 'failed on Windows',
      solution: 'use junctions',
      tags: ['jest'],
    });

    const enhancer = new PromptEnhancer({
      provider: mockProvider,
      negativeKnowledge: nkStore,
      sop: mockSop,
      toolShed: mockToolShed,
    });

    // Trigger enhance with a prompt that matches the NK entry
    enhancer.enhance('deploy failure NTFS');

    const injected = enhancer.getInjectedNkEntries();
    expect(injected.length).toBeGreaterThan(0);
    expect(injected[0].id).toBe(entry.id);
  });

  it('clearInjectedNkEntries resets tracking', () => {
    // Same setup as above...
    const nkStore = new NegativeKnowledgeStore(tmpDir);
    nkStore.add({
      scenario: 'deploy failure on NTFS',
      attempt: 'used symlinks',
      outcome: 'failed on Windows',
      solution: 'use junctions',
      tags: ['jest'],
    });

    const enhancer = new PromptEnhancer({
      provider: mockProvider,
      negativeKnowledge: nkStore,
      sop: mockSop,
      toolShed: mockToolShed,
    });

    enhancer.enhance('deploy failure NTFS');
    expect(enhancer.getInjectedNkEntries().length).toBeGreaterThan(0);

    enhancer.clearInjectedNkEntries();
    expect(enhancer.getInjectedNkEntries()).toEqual([]);
  });
});
```

Note: Adapt mock names to match existing test file patterns. Check `tests/pipeline/prompt-enhancer.test.ts` for existing mock setup.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/pipeline/prompt-enhancer.test.ts --runInBand --forceExit`
Expected: FAIL — getInjectedNkEntries/clearInjectedNkEntries not defined

- [ ] **Step 3: Implement injection tracking in PromptEnhancer**

In `src/pipeline/prompt-enhancer.ts`:

1. Add field: `private injectedNkEntries: NegativeKnowledgeEntry[] = [];`
2. Import `NegativeKnowledgeEntry` from `../phase1/negative-knowledge`
3. In `enhance()`, change the NK search block to keep full entries:

```typescript
// Replace the current failures variable type with full entries
let nkEntries: NegativeKnowledgeEntry[] = [];
if (this.config.projectNegativeKnowledge) {
  nkEntries = this.config.projectNegativeKnowledge.searchByKeyword(keyTerms).slice(0, maxNk);
}
const remainingSlots = maxNk - nkEntries.length;
if (remainingSlots > 0) {
  const globalEntries = this.config.negativeKnowledge.searchByKeyword(keyTerms).slice(0, remainingSlots);
  nkEntries = [...nkEntries, ...globalEntries];
}

// Track what was injected
this.injectedNkEntries = [...nkEntries];

// Use nkEntries for display (same output as before)
const failures = nkEntries;
```

4. Add getter and clear methods:

```typescript
getInjectedNkEntries(): NegativeKnowledgeEntry[] {
  return [...this.injectedNkEntries];
}

clearInjectedNkEntries(): void {
  this.injectedNkEntries = [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/pipeline/prompt-enhancer.test.ts --runInBand --forceExit`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/prompt-enhancer.ts tests/pipeline/prompt-enhancer.test.ts
git commit -m "feat(nk-vote): PromptEnhancer tracks injected NK entries"
```

---

### Task 8: NK Promoter — import FRAMEWORK_TAGS, remove votes:0, init vote_metrics

**Files:**
- Modify: `src/pipeline/nk-promoter.ts`
- Modify: `tests/pipeline/nk-promoter.test.ts`

- [ ] **Step 1: Write failing tests**

Note: `GeneralizedEntry` interface in nk-promoter.ts does not currently have a `vote_metrics` field. This task adds it.

```typescript
// Add to tests/pipeline/nk-promoter.test.ts
describe('vote_metrics initialization', () => {
  it('generalize() removes votes:0 from tags', () => {
    const promoter = makePromoter({ projectName: 'test-project' });
    const entry = makeEntry({ tags: ['jest', 'auto-recorded'] });
    const result = promoter.generalize(entry);
    expect(result.tags).not.toContain('votes:0');
    expect(result.tags).toContain('promoted');
    expect(result.tags).toContain('unvalidated');
  });

  it('generalize() initializes vote_metrics with _default context', () => {
    const promoter = makePromoter({ projectName: 'test-project' });
    const entry = makeEntry({ tags: ['jest', 'auto-recorded'] });
    const result = promoter.generalize(entry);
    expect(result.vote_metrics).toEqual({
      contexts: { _default: { successes: 0, total_attempts: 0 } },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/pipeline/nk-promoter.test.ts --runInBand --forceExit`
Expected: FAIL — tags still contains `votes:0`

- [ ] **Step 3: Update nk-promoter.ts**

1. Replace the local `FRAMEWORK_TAGS` import:

```typescript
import { FRAMEWORK_TAGS } from './nk-vote-tracker';
```

Remove the local `const FRAMEWORK_TAGS = new Set([...]);` declaration.

2. In `generalize()`, remove `'votes:0'` from the tags array and add `vote_metrics` initialization:

```typescript
const tags = [
  ...originalTags,
  'promoted',
  'unvalidated',
  `source:${this.config.projectName}`,
  `promoted:${date}`,
];
```

3. Add `vote_metrics` to the `GeneralizedEntry` interface:

```typescript
export interface GeneralizedEntry {
  // ... existing fields ...
  vote_metrics: VoteMetrics;
}
```

Import `VoteMetrics` from `../phase1/negative-knowledge`.

4. In `generalize()` return statement, add:

```typescript
return {
  scenario, attempt, outcome, solution, tags,
  originalTags: [...entry.tags], crossProjectReason,
  vote_metrics: { contexts: { _default: { successes: 0, total_attempts: 0 } } },
};
```

- [ ] **Step 3b: Fix existing test assertions that expect `votes:0`**

In `tests/pipeline/nk-promoter.test.ts`:

1. Line ~169: Change `expect(gen.tags).toContain('votes:0');` to `expect(gen.tags).not.toContain('votes:0');`

2. Line ~324: In the `toIntakeMarkdown` test, update the fixture `tags` array from `['jest', 'promoted', 'unvalidated', 'votes:0']` to `['jest', 'promoted', 'unvalidated']`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/pipeline/nk-promoter.test.ts --runInBand --forceExit`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass — verify no other tests depended on `votes:0` being in tags

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/nk-promoter.ts tests/pipeline/nk-promoter.test.ts
git commit -m "refactor(nk-promoter): import FRAMEWORK_TAGS from nk-vote-tracker, remove votes:0 tag"
```

---

### Task 9: Pipeline integration — build and attach vote receipts

**Files:**
- Modify: `src/pipeline/eba-pipeline.ts`
- Modify: `tests/pipeline/eba-pipeline.integration.test.ts`

- [ ] **Step 1: Write failing test**

Read `tests/pipeline/eba-pipeline.integration.test.ts` first to understand the existing mock setup (mock providers, temp dirs, SOP, ToolShed patterns). Then add:

```typescript
// Add to tests/pipeline/eba-pipeline.integration.test.ts
describe('vote receipt attachment', () => {
  it('attaches vote_receipts to memory packet when NK entries were injected', async () => {
    // Use the existing test setup pattern from this file.
    // Key additions:
    // 1. Pre-populate the NK solutions dir with an entry that will match the active task
    // 2. Run the pipeline
    // 3. Read the written packet JSON from packetsDir
    // 4. Assert:
    const packetFiles = fs.readdirSync(packetsDir).filter(f => f.endsWith('.json'));
    expect(packetFiles.length).toBeGreaterThan(0);
    const packet = JSON.parse(fs.readFileSync(path.join(packetsDir, packetFiles[0]), 'utf-8'));
    // NK entry keywords must overlap with active task text to guarantee injection.
    // The test setup should ensure this (e.g., NK scenario "test failure" + task "fix test failure").
    expect(packet.vote_receipts).toBeDefined();
    expect(Array.isArray(packet.vote_receipts)).toBe(true);
    expect(packet.vote_receipts.length).toBeGreaterThan(0);
    expect(packet.vote_receipts[0]).toHaveProperty('nk_id');
    expect(packet.vote_receipts[0]).toHaveProperty('context_keys');
    expect(packet.vote_receipts[0]).toHaveProperty('succeeded');
    expect(packet.vote_receipts[0]).toHaveProperty('timestamp');
  });
});
```

Note: The NK entry must contain keywords that overlap with the active task text for `searchByKeyword` to find it. Use a scenario like "test failure" and an active task like "fix test failure in module".

- [ ] **Step 2: Implement vote receipt building in EBAPipeline.run()**

In `src/pipeline/eba-pipeline.ts`, import:

```typescript
import { createVoteReceipts } from './nk-vote-tracker';
```

In the post-task block, after NK recording but before compression, add:

```typescript
// Build vote receipts from injected NK entries
let voteReceipts: VoteReceipt[] = [];
if (enhancer.getInjectedNkEntries) {
  const injectedEntries = enhancer.getInjectedNkEntries();
  const targetDir = this.config.targetProjectDir ?? path.dirname(this.config.docsDir);
  voteReceipts = createVoteReceipts(injectedEntries, targetDir, succeeded);
}
```

In the retry loop, at the top of each iteration (before `createOrchestratorExecutor`):

```typescript
enhancer.clearInjectedNkEntries();
```

When building the memory packet (in the compression block), attach receipts:

```typescript
if (voteReceipts.length > 0) {
  packet.vote_receipts = voteReceipts;
}
```

Also attach to the pendingMerge packet write if present.

- [ ] **Step 3: Run integration tests**

Run: `npx jest tests/pipeline/eba-pipeline.integration.test.ts --runInBand --forceExit`
Expected: PASS

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/eba-pipeline.ts tests/pipeline/eba-pipeline.integration.test.ts
git commit -m "feat(nk-vote): pipeline builds and attaches vote receipts to memory packets"
```

---

### Task 10: Merge Agent — process receipts in sweep(), union in mergePackets()

**Files:**
- Modify: `src/pipeline/merge-agent.ts`
- Modify: `tests/pipeline/merge-agent.test.ts`

- [ ] **Step 1: Write failing tests for mergePackets vote_receipts union**

```typescript
// Add to tests/pipeline/merge-agent.test.ts
describe('mergePackets vote_receipts', () => {
  it('unions vote_receipts from multiple packets', () => {
    const p1 = makePacket({
      vote_receipts: [
        { nk_id: 'nk_1', context_keys: ['jest'], succeeded: true, timestamp: '2026-03-24' },
      ],
    });
    const p2 = makePacket({
      vote_receipts: [
        { nk_id: 'nk_2', context_keys: ['next'], succeeded: false, timestamp: '2026-03-24' },
      ],
    });
    const merged = mergePackets([p1, p2]);
    expect(merged.vote_receipts).toHaveLength(2);
    expect(merged.vote_receipts!.map(r => r.nk_id)).toContain('nk_1');
    expect(merged.vote_receipts!.map(r => r.nk_id)).toContain('nk_2');
  });

  it('deduplicates receipts by nk_id + context_keys', () => {
    const receipt = { nk_id: 'nk_1', context_keys: ['jest'], succeeded: true, timestamp: '2026-03-24' };
    const p1 = makePacket({ vote_receipts: [receipt] });
    const p2 = makePacket({ vote_receipts: [receipt] });
    const merged = mergePackets([p1, p2]);
    expect(merged.vote_receipts).toHaveLength(1);
  });

  it('omits vote_receipts when no packets have them', () => {
    const p1 = makePacket();
    const p2 = makePacket();
    const merged = mergePackets([p1, p2]);
    expect(merged.vote_receipts).toBeUndefined();
  });
});
```

Note: `makePacket()` should be adapted from existing test helpers in `merge-agent.test.ts`.

- [ ] **Step 2: Write failing tests for sweep() vote processing**

```typescript
// Add to tests/pipeline/merge-agent.test.ts
describe('sweep vote receipt processing', () => {
  it('applies vote receipts to global NK store and strips from merged packet', async () => {
    // 1. Create a global NK store with an entry in a temp dir
    const nkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nk-sweep-'));
    const nkStore = new NegativeKnowledgeStore(nkDir);
    const nkEntry = nkStore.add({
      scenario: 'test', attempt: 'a', outcome: 'o', solution: 's', tags: ['jest'],
    });
    nkStore.saveToDisk();

    // 2. Write a pending packet with vote_receipts
    const packet = createValidPacket();
    packet.vote_receipts = [{
      nk_id: nkEntry.id,
      context_keys: ['jest'],
      succeeded: true,
      timestamp: new Date().toISOString(),
    }];
    fs.writeFileSync(path.join(pendingDir, 'test.json'), JSON.stringify(packet));

    // 3. Run sweep with globalNkStore
    const agent = new MergeAgent({ pendingDir, packetsDir, globalNkStore: nkStore });
    const result = await agent.sweep();

    // 4. NK entry should have incremented vote_metrics
    nkStore.loadFromDisk();
    const updated = nkStore.get(nkEntry.id)!;
    expect(updated.vote_metrics!.contexts['jest']).toEqual({ successes: 1, total_attempts: 1 });

    // 5. Merged output should NOT have vote_receipts
    expect(result.merged).toBe(true);
    const outputContent = JSON.parse(fs.readFileSync(result.outputPath!, 'utf-8'));
    expect(outputContent.vote_receipts).toBeUndefined();

    fs.rmSync(nkDir, { recursive: true, force: true });
  });

  it('handles crash recovery — master packet with unprocessed receipts', async () => {
    // Write a master packet to packetsDir that still has vote_receipts
    // (simulates a crash between load and strip in a previous sweep)
    const nkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nk-crash-'));
    const nkStore = new NegativeKnowledgeStore(nkDir);
    const nkEntry = nkStore.add({
      scenario: 'crash', attempt: 'a', outcome: 'o', solution: 's', tags: ['next'],
    });
    nkStore.saveToDisk();

    // Master packet with unprocessed receipts already in packetsDir
    const masterPacket = createValidPacket();
    masterPacket.vote_receipts = [{
      nk_id: nkEntry.id,
      context_keys: ['next'],
      succeeded: true,
      timestamp: new Date().toISOString(),
    }];
    fs.writeFileSync(path.join(packetsDir, 'master_merged.json'), JSON.stringify(masterPacket));

    // New pending packet (no receipts)
    const newPacket = createValidPacket();
    newPacket.session_id = 'new_session';
    fs.writeFileSync(path.join(pendingDir, 'new.json'), JSON.stringify(newPacket));

    // Sweep should pick up receipts from master + apply them
    const agent = new MergeAgent({ pendingDir, packetsDir, globalNkStore: nkStore });
    await agent.sweep();

    nkStore.loadFromDisk();
    const updated = nkStore.get(nkEntry.id)!;
    expect(updated.vote_metrics!.contexts['next']).toEqual({ successes: 1, total_attempts: 1 });

    fs.rmSync(nkDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 3: Implement mergePackets union**

In `mergePackets()`, after building the merged packet (line ~210), add vote_receipts union:

```typescript
// Union vote_receipts
const allReceipts: VoteReceipt[] = [];
const receiptKeys = new Set<string>();
for (const pkt of packets) {
  for (const receipt of pkt.vote_receipts ?? []) {
    const key = `${receipt.nk_id}|${receipt.context_keys.sort().join('+')}`;
    if (!receiptKeys.has(key)) {
      receiptKeys.add(key);
      allReceipts.push(receipt);
    }
  }
}
if (allReceipts.length > 0) {
  merged.vote_receipts = allReceipts;
}
```

- [ ] **Step 4: Implement sweep() vote processing**

Add to `MergeAgentConfig`:
```typescript
globalNkStore?: NegativeKnowledgeStore;
```

In `sweep()`, before the merge call, add vote receipt processing:

```typescript
// Process vote receipts before merging
if (this.config.globalNkStore) {
  const allReceipts: VoteReceipt[] = [];
  for (const pkt of allPackets) {
    if (pkt.vote_receipts) {
      allReceipts.push(...pkt.vote_receipts);
    }
  }
  if (allReceipts.length > 0) {
    const { applied, skipped } = applyVoteReceipts(this.config.globalNkStore, allReceipts);
    this.config.globalNkStore.saveToDisk();
    if (applied > 0) {
      console.log(`🗳️  Applied ${applied} vote receipt(s) to global NK store`);
    }
    if (skipped > 0) {
      console.warn(`⚠️  Skipped ${skipped} vote receipt(s) (entries not found)`);
    }
  }
}

// Strip receipts before merge (use undefined, not delete — avoids mutating frozen objects)
const strippedPackets = allPackets.map(pkt => ({ ...pkt, vote_receipts: undefined }));

// IMPORTANT: Change the existing merge call from:
//   const mergedPacket = mergePackets(allPackets);
// to:
const mergedPacket = mergePackets(strippedPackets);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/pipeline/merge-agent.test.ts --runInBand --forceExit`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/pipeline/merge-agent.ts tests/pipeline/merge-agent.test.ts
git commit -m "feat(nk-vote): merge agent processes vote receipts in sweep, unions in mergePackets"
```

---

### Task 11: Full integration verification

**Files:**
- No new files — verification only

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass, no regressions

- [ ] **Step 2: Run typecheck**

Run: `npm run lint`
Expected: Clean — no type errors

- [ ] **Step 3: Verify no circular imports**

Run: `npx ts-node -e "import './src/pipeline/nk-vote-tracker'; import './src/phase1/negative-knowledge'; import './src/phase1/memory-packet'; import './src/pipeline/nk-promoter'; import './src/pipeline/merge-agent'; console.log('No circular imports')"`
Expected: Prints "No circular imports" without errors

- [ ] **Step 4: Commit any final fixes**

If any issues found, fix and commit with descriptive message.
