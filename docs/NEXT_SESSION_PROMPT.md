# EBA — Next Session Bootstrap

## System state
- Branch: `main`
- Last known verification state: **229 tests passing across 27 suites**, exit 0
- Security posture after last session: **hardened**
  - Path containment in file tooling
  - Bash command prefix allowlist
  - Injection-safe test command execution
  - Critical-action approval gate enforced even in dev mode by default
- Session closed with no reported failing checks; start by confirming with:
  - `npm test`
  - `npm run lint`

## What was completed last session
A focused security hardening pass addressed a 23-finding audit for commit `6ad7244`. All escalated findings (**4 CRITICAL + 2 HIGH**) were resolved.

Implemented changes:
- `ToolShed` gained project-root path containment (`projectRoot` + path validation)
- `bash_execute` gained strict prefix allowlist (`npm`, `npx`, `jest`, `git`, `node`, `ts-node`, `tsc`)
- `test_runner` moved from string-based `execSync` invocation to `execFileSync` with argument arrays
- Three-Pillar defaults now classify `bash_execute` as `critical` + `requires_approval: true`
- Dev mode no longer silently bypasses critical approvals; override is explicit via `EBA_AUTO_APPROVE_CRITICAL=true`
- `PromptEnhancer` now correctly proxies `callWithTools`, restoring wrapped-provider tool-calling behavior

Files changed in that session:
- `src/phase2/tool-shed.ts`
- `src/phase3/three-pillar-model.ts`
- `src/pipeline/prompt-enhancer.ts`
- `src/run.ts`
- `tests/phase2/tool-executor.test.ts`
- `tests/phase1/tool-loop.test.ts`

## Security model (new — important for next engineer)
1. **Project-root containment (ToolShed)**
   - File operations are still available (by design), but now constrained to a validated `projectRoot` boundary.
   - This blocks traversal/out-of-scope access without removing core functionality.

2. **Bash prefix allowlist**
   - `bash_execute` only permits approved prefixes: `npm`, `npx`, `jest`, `git`, `node`, `ts-node`, `tsc`.
   - This preserves legitimate engineering workflows while reducing arbitrary shell abuse surface.

3. **Injection-safe test runner execution**
   - `test_runner` now uses `execFileSync` with arg arrays (no interpolated shell string).
   - This eliminates the specific injection class tied to command-string construction.

4. **Critical gate enforcement in dev mode**
   - `bash_execute` is now first-class critical risk in 3PM defaults.
   - Critical actions are blocked by default even when running with dev ergonomics.
   - Local override requires **explicit opt-in**: `EBA_AUTO_APPROVE_CRITICAL=true` in `.env.local`.

## Open items (prioritized)
1. **Implement `code_analyzer` (currently no-op stub).**
   - It currently returns path-only output without meaningful analysis.
   - Add real analysis behavior and tests that validate non-trivial results.

2. **Compute real `fidelity_score` in `compression-agent`.**
   - It is currently hardcoded at `1.0`.
   - Replace with measurable scoring (coverage/retention quality) + test assertions.

3. **Document `EBA_AUTO_APPROVE_CRITICAL` in `.env.local.example` with warning language.**
   - Must communicate that enabling it weakens default critical-action safeguards.

4. **Regenerate architecture diagrams (currently `diagramDrift: true`).**
   - Run the relevant audit/regeneration flow and commit updated visual artifacts.

## Known deferred findings
- Prompt injection via transcript context: accepted for now (internal data boundary + NK sanitization considered sufficient defense-in-depth)
- Long functions in tool-shed/pipeline orchestration: readability acceptable at present
- `code_analyzer` no-op and `fidelity_score` hardcoded: tracked for follow-up
- Diagram drift pending regeneration: deferred to next audit cycle

## Key architectural notes
- `PromptEnhancer` now proxies `callWithTools` correctly (tool-calling no longer dropped through wrapper path).
- `createDefaultToolShed` supports optional `projectRoot`, and call sites should pass explicit roots when operating in temp/test sandboxes.
- Three-Pillar default for `bash_execute` is now `critical` with `requires_approval: true`.
- Dev mode no longer auto-approves critical actions unless `EBA_AUTO_APPROVE_CRITICAL=true` is explicitly set.

## Environment
- WSL2 environment
- Node.js 22
- Jest 29
- TypeScript 5.3.3
- Use: `npm test` (configured as `jest --runInBand --forceExit` for WSL2 stability)
- Typecheck/lint gate: `npm run lint`

