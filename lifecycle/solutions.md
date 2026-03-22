# Solutions — Patterns That Worked

> Curated by /harden, organized by /audit.
> Entries include source commit and context.

## Security

### Path containment for LLM-controlled file operations
Validate all file paths resolve inside the project root using `path.resolve()` + `startsWith()` before any `fs` operation. Applied to `file_read`, `file_write`, `file_edit` in `ToolShed.execute()`.
*Source: /harden eba-core-build (2026-03-21) — prevents LLM from reading/writing outside project root*

### Command injection prevention via execFileSync
Use `execFileSync` with an args array instead of `execSync` with string interpolation. Eliminates the entire class of shell injection. Applied to `test_runner` tool.
*Source: /harden eba-core-build (2026-03-21) — filter parameter was injectable via quote breakout*

### Command prefix allowlist for agentic shell execution
Only allow commands starting with known-safe prefixes (`npm`, `npx`, `jest`, `git`, `node`, `ts-node`, `tsc`). Hard-reject anything else before it reaches the shell.
*Source: /harden eba-core-build (2026-03-21) — prevents arbitrary command execution by LLM*

## Architecture

### PromptEnhancer must forward callWithTools
When wrapping an `LLMProvider` with a decorator, the decorator must implement `callWithTools()` — not just `call()`. Otherwise the tool-calling loop silently breaks because it checks `provider.callWithTools` and finds `undefined`.
*Source: /harden eba-core-build (2026-03-21) — decorator must forward callWithTools or tool loop silently breaks*

## Imports

### Import types from their source module
When `isolatedModules: true` + `strict: true`, import types from the module that defines them, not from a module that re-imports them internally. `ToolSchema` is defined in `phase2/tool-shed.ts`, not `phase1/orchestrator.ts`.
*Source: 0b988e7 /gate (2026-03-20) — isolatedModules + strict makes this a hard error*

## Concurrency

### Atomic SQLite claim with BEGIN IMMEDIATE
Use `db.transaction(() => { ... }).immediate()` for cross-process atomic claim operations. `BEGIN IMMEDIATE` acquires a RESERVED lock before the SELECT runs, preventing two processes from racing on the same row under WAL mode.
```typescript
const claimTxn = this.db.transaction(() => {
  return this.db.prepare(`UPDATE tasks SET status='claimed' ... RETURNING *`).get(agentId, now, now);
});
const row = claimTxn.immediate() as TaskRow | undefined;
```
*Source: 6f67402 (2026-03-21) — prevents double-claim in multi-agent mode*

### staleCheck with JavaScript Date math, not SQLite datetime()
When `claimed_at` is stored as ISO 8601 from JavaScript (`new Date().toISOString()`), compare against JavaScript-computed cutoffs, not `datetime('now', '-N seconds')`. SQLite's `datetime()` returns `YYYY-MM-DD HH:MM:SS` (no T, no Z) — mismatched string comparison produces wrong results.
*Source: plan review (2026-03-21) — caught during spec review before implementation*

### Advisory lockfile for non-DB concurrency
Use `proper-lockfile` with `retries: 0` for non-blocking lock acquisition. If the lock is held, return immediately (another process handles it). Use `stale: 30000` to auto-recover from crashed lock holders.
*Source: 8e46633 (2026-03-21) — merge agent sweep() lockfile pattern*
