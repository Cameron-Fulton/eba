# NK Vote Incrementing — Design Spec

**Date:** 2026-03-24
**Status:** Approved
**Scope:** Write path only (tracking + incrementing). Read path (Wilson Score ranking in retrieval) is a follow-up.

## Problem

Promoted NK entries start with `votes:0` and `unvalidated` status. There is no mechanism to validate whether a promoted entry actually helps solve tasks in other projects. The feedback loop is open.

## Solution

Track which NK entries are injected into prompts, record whether the task succeeded or failed, and increment context-scoped vote metrics on those entries. Use a lock-free Vote Receipt pattern to avoid concurrency hazards in multi-agent execution.

---

## Section 1: Schema Changes

### New types

```typescript
interface VoteContext {
  successes: number;
  total_attempts: number;
}

interface VoteMetrics {
  contexts: Record<string, VoteContext>;
}
```

### NegativeKnowledgeEntry addition

```typescript
interface NegativeKnowledgeEntry {
  // ... existing fields (id, scenario, attempt, outcome, solution, tags, timestamp) ...
  vote_metrics?: VoteMetrics;
}
```

The field is optional for backward compatibility. Entries without `vote_metrics` are treated as `{ contexts: { "_default": { successes: 0, total_attempts: 0 } } }`.

### Context key format

- **Individual keys:** One per framework/tool tag, e.g., `"jest"`, `"next"`, `"prisma"`
- **Compound key:** Alphabetically sorted, `+` joined, e.g., `"next+prisma"`. Always constructed via tiered filtering (see Section 2). Minimum 2 tags required to form a compound key.
- **Legacy key:** `"_default"` — used for entries promoted before this feature, or when no framework tags are detected.

### Markdown format

New line after `**Tags:**` in NK markdown files:

```
**Vote Metrics:** jest: 2/3, next: 1/2, jest+next: 1/1, _default: 0/0
```

Format: `key: successes/total_attempts`, comma-separated.

### Backward compatibility

The `votes:0` and `unvalidated` tags in promoted entries become vestigial — kept for human readability but no longer the source of truth. The `vote_metrics` field is the canonical store.

---

## Section 2: Context Key Construction

### Two sources fused

1. **Project stack** — `detectFrameworks()` reads the target project's `package.json` dependencies and filters against the `FRAMEWORK_TAGS` whitelist (same set used by NK promoter).
2. **Task-specific tags** — The NK entry's own tags intersected with `FRAMEWORK_TAGS`, plus SOP-derived tags where applicable.

### Tag priority tiers

Compound keys are always constructed via tiering to prevent bloat:

```typescript
const TIER_1_FRAMEWORKS = new Set([
  'next', 'react', 'vue', 'svelte', 'express', 'fastify', 'django', 'rails'
]);
const TIER_2_INTEGRATIONS = new Set([
  'prisma', 'database', 'auth', 'oauth', 'websocket', 'docker', 'cache'
]);
// TIER_3 = everything else in FRAMEWORK_TAGS (jest, eslint, typescript, webpack...)
// TIER_3 tags get individual keys but NEVER appear in compound keys
```

### buildContextKeys logic

```typescript
function buildContextKeys(
  projectFrameworks: string[],
  taskTags: string[]
): string[] {
  const all = [...new Set([...projectFrameworks, ...taskTags])]
    .map(t => t.toLowerCase())
    .sort();

  if (all.length === 0) return ["_default"];

  // Individual keys — always all of them
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
    keys.push(compoundTags.join("+"));
  }

  return keys;
}
```

### detectFrameworks

New method on `ContextDiscovery` (or standalone utility in `nk-vote-tracker.ts`):

```typescript
function detectFrameworks(projectDir: string): string[] {
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
```

---

## Section 3: PromptEnhancer Injection Tracking

### Changes to PromptEnhancer

1. Add `private injectedNkEntries: NegativeKnowledgeEntry[] = []` field
2. In `enhance()`, after NK search, capture the full entry references (not just destructured fields)
3. Expose `getInjectedNkEntries(): NegativeKnowledgeEntry[]`
4. Expose `clearInjectedNkEntries(): void` — called between attempts

### Current code fix

The current NK search in `enhance()` stores entries as `{ scenario, attempt, outcome, solution }`, losing the `id` and `tags`. Fix: keep the full `NegativeKnowledgeEntry` reference and extract display fields at render time.

### No behavior change

PromptEnhancer's prompt output is identical. The only change is internal bookkeeping of which entries were injected.

---

## Section 4: Wilson Score & Fallback Chain

### Wilson Score Lower Bound

```typescript
function wilsonScore(successes: number, total: number, z = 1.96): number {
  if (total === 0) return 0;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return (center - spread) / denominator;
}
```

Uses z=1.96 (95% confidence interval). Returns the lower bound — conservative estimate of true success rate.

### Fallback chain for retrieval ranking (future read path)

1. **Compound key** — use if `total_attempts >= 3`
2. **Best individual key** — highest Wilson score among individual keys with `total_attempts >= 3`
3. **`_default`** — use if nothing else qualifies
4. **Score of 0** — truly unknown entry

### Scope

The Wilson score function and fallback logic are implemented in this PR. Integration into PromptEnhancer's search ranking is a separate follow-up.

---

## Section 5: Pipeline Integration (Lock-Free Vote Receipts)

### Concurrency constraint

EBA runs parallel worker agents. Workers must NEVER directly mutate the global NK store. All vote mutations go through the Merge Agent, which operates synchronously under `proper-lockfile`.

### VoteReceipt structure

```typescript
interface VoteReceipt {
  nk_id: string;
  context_keys: string[];
  succeeded: boolean;
  timestamp: string;
}
```

### MemoryPacket schema addition

```typescript
interface MemoryPacket {
  // ... existing fields ...
  vote_receipts?: VoteReceipt[];
}
```

### Pipeline post-task flow (in EBAPipeline.run())

1. Get injected NK entries from `enhancer.getInjectedNkEntries()`
2. Detect project frameworks via `detectFrameworks(targetProjectDir)`
3. For each injected entry:
   a. Extract task-specific tags (`entry.tags ∩ FRAMEWORK_TAGS`)
   b. Build context keys via `buildContextKeys(projectFrameworks, taskTags)`
   c. Create a `VoteReceipt` with `succeeded` based on task outcome
4. Attach `vote_receipts` array to the memory packet
5. **No** `nkStore.update()`, **no** `saveToDisk()` — workers are read-only on global NK

### Merge Agent responsibility

In `sweep()` (not `mergePackets()`):

1. Read `vote_receipts` from each pending memory packet
2. Load global NK store
3. For each receipt: increment `total_attempts` on all context keys; increment `successes` if `succeeded === true`
4. Save global NK store to disk
5. **Process and Strip:** Remove `vote_receipts` from the merged packet before writing to `docs/memory-packets/`. This prevents historical vote logs from consuming token budget in future context loads.

### mergePackets() stays pure

`mergePackets()` remains a pure, deterministic function: takes packets in, returns one merged packet out. All I/O (NK store load, vote increment, disk save, receipt stripping) lives in the async `sweep()` wrapper.

### Durability

If the Merge Agent isn't running, receipts persist in the memory packet JSON files. Next `sweep()` invocation picks them up. No data loss.

---

## New File

`src/pipeline/nk-vote-tracker.ts` — contains:
- `VoteMetrics`, `VoteContext`, `VoteReceipt` type exports
- `TIER_1_FRAMEWORKS`, `TIER_2_INTEGRATIONS` constants
- `buildContextKeys(projectFrameworks, taskTags)` — key construction
- `detectFrameworks(projectDir)` — package.json scanning
- `wilsonScore(successes, total, z?)` — Wilson Score Lower Bound
- `incrementVotes(entry, contextKeys, succeeded)` — pure function, returns updated entry
- `createVoteReceipts(entries, projectDir, succeeded)` — convenience for pipeline
- `applyVoteReceipts(nkStore, receipts)` — for merge agent's sweep()

## Modified Files

- `src/phase1/negative-knowledge.ts` — Add `vote_metrics?: VoteMetrics` to entry interface, update `toMarkdown()`/`parseNKMarkdown()` for Vote Metrics line
- `src/phase1/memory-packet.ts` — Add `vote_receipts?: VoteReceipt[]` to MemoryPacket interface, update validation
- `src/pipeline/prompt-enhancer.ts` — Track injected NK entries, expose getter/clear
- `src/pipeline/eba-pipeline.ts` — Build vote receipts post-task, attach to memory packet
- `src/pipeline/nk-promoter.ts` — Initialize `vote_metrics: { contexts: { "_default": { successes: 0, total_attempts: 0 } } }` on promoted entries (replaces vestigial `votes:0` tag as source of truth)

## Key Decisions

1. **Context-only metrics, no global aggregates** — Wilson Score computed per-context to avoid blended average trap
2. **Attribute combination keys** — Fuse project stack + task tags for precise context matching
3. **Tiered compound keys** — Tier 1 framework + Tier 2 integrations only; ambient tools (eslint, jest) get individual keys but never compound
4. **Lock-free vote receipts** — Workers attach receipts to packets; Merge Agent applies under lockfile
5. **Process and Strip** — Receipts removed from merged packets to preserve token budget
6. **mergePackets() stays pure** — All I/O in sweep()
7. **Write path only** — This spec covers tracking + incrementing. Retrieval ranking via Wilson Score is a follow-up.
