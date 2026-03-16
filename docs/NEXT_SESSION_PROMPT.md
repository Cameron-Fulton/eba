# Next Session Bootstrap Prompt

## Project
**Episodic Blueprint Architecture (EBA)** — `/mnt/d/projects/eba`
An autonomous AI engineering system with episodic memory, thread isolation, multi-model validation, and a four-phase architecture.

## Environment Notes
- WSL2 on Windows NTFS mount — **Jest and ts-jest hang without `--runInBand`**
- Fix is already applied: `tsconfig.json` has `isolatedModules: true`, `package.json` test script is `jest --runInBand --forceExit`
- Always run tests via `npm test` or `node_modules/.bin/jest --runInBand --forceExit`
- Node v22.22.1, Jest 29.7.0, TypeScript 5.3.3

## Current State (commit 3f2f028, 2026-03-16)
- **Branch:** main (2 commits ahead of origin/main)
- **Tests:** 18 suites, 151 tests — all passing, exit 0
- **npm audit:** 0 vulnerabilities
- **Active task:** None — ready for next assignment

## What Was Done This Session

### 1. Jest Fix (WSL2)
- Root cause: ts-jest type-checker and Jest worker pool both hang on NTFS mounts
- Fix: `isolatedModules: true` in `tsconfig.json` (transpile-only, no tsc hang)
- Fix: `--runInBand` in `package.json` test script (single process, no worker pool)

### 2. Security Hardening
All of the following were applied and committed in `3f2f028`:

| Severity | Location | Fix |
|----------|----------|-----|
| High | `src/run.ts` | TEST_COMMAND rejects shell metacharacters (; \| & $ ` < >) |
| High | `src/run-arena.ts` | SOLUTIONS_DIR validated to stay inside project root |
| Medium | `src/pipeline/prompt-enhancer.ts` | NK entries sanitized (headers/bold stripped) before LLM injection |
| Medium | `src/pipeline/eba-pipeline.ts` | approvalMode defaults to 'strict'; dev is explicit opt-in |
| Medium | `src/providers/model-router.ts` | destroy() added; static instances Set is now cleanable |
| Medium | `src/scheduler.ts` | Returns NodeJS.Timeout; SIGINT/SIGTERM/exit handlers wired in run.ts |
| Low | `src/phase1/negative-knowledge.ts` | Math.random() replaced with crypto.randomUUID() |

## Architecture Quick Reference
```text
Phase 1 — Memory & Orchestration
  orchestrator.ts          BlueprintOrchestrator — retry loop, context saturation
  negative-knowledge.ts    NegativeKnowledgeStore — prevents repeating failures
  ai-index.ts              SQLite FTS5 search index for NK
  compression-agent.ts     Compresses sessions into MemoryPackets
  memory-packet.ts         MemoryPacket schema and validation

Phase 2 — SOPs & Threading
  sop.ts                   SOPEngine — workflow step management
  sop-library.ts           Pre-built SOP definitions
  thread-manager.ts        Concurrent task dispatch with timeout
  thread-executor.ts       Adapter: orchestrator => thread episode
  tool-shed.ts             Tool registry with category/risk filtering

Phase 3 — Validation & Trust
  consortium-voter.ts      Multi-model consensus (Claude + Gemini + GPT)
  three-pillar-model.ts    Transparency / Accountability / Trustworthiness
  visual-proof.ts          Post-success verification hook system

Phase 4 — Optimisation
  arena-loop.ts            Iterative metric optimisation loop
  parallel-negative-knowledge.ts  Concurrent failure avoidance

Pipeline
  eba-pipeline.ts          Full integration: NK => SOP => Orchestrator => Compression
  prompt-enhancer.ts       Injects NK + SOP + tools into every LLM prompt

Providers
  model-router.ts          Routes by complexity: routine / standard / complex
  claude-provider.ts       Anthropic SDK
  gemini-provider.ts       Google Generative AI SDK
  openai-provider.ts       OpenAI SDK
  openrouter-provider.ts   OpenRouter (OpenAI-compat)
  benchmark-updater.ts     Fetches model benchmarks to pick best OpenRouter models
  scheduler.ts             Periodic benchmark refresh (NodeJS.Timeout handle returned)

Entry Points
  run.ts                   Main — boots full pipeline from ACTIVE_TASK.md
  run-arena.ts             Arena loop runner
```

## Open Items (prioritised)
1. **Push to origin** — 2 commits ahead of origin/main, never pushed
2. **Benchmark tests missing** — `src/benchmark/` (run-benchmark, sop-coverage, task-corpus) has no test coverage
3. **Open handle warning** — `--forceExit` covers it but root cause unknown; AIIndex was ruled out
4. **OpenRouter probe** — prior session found 2/4 tests passing; Nemotron reasoning tokens and generation lookup documented in `docs/kamakazi/` but not resolved
5. **`src/index.ts`** — public API barrel file; contents not reviewed

## How to Pick Up
```bash
cd /mnt/d/projects/eba
npm test                     # verify 151 tests still green
cat docs/ACTIVE_TASK.md      # check for assigned work
git log --oneline -5         # confirm state
```

## Key Commands
```bash
npm test                          # full suite (runInBand + forceExit)
npm run lint                      # tsc --noEmit type check
npm run build                     # compile to dist/
npx ts-node src/run.ts            # run pipeline against ACTIVE_TASK.md
npx ts-node src/run-arena.ts      # run arena optimisation loop
git log --oneline -5              # recent commits
git push                          # push 2 pending commits to origin
```
