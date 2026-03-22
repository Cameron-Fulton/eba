# Harden Report — Story multi-agent-arch: Multi-Agent Architecture

**Date:** 2026-03-21
**Commits:** cb8fa27..be508b5
**Files changed:** 22 (11 source commits + 1 harden commit)

## Findings

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | LOW | `peek()` in task-queue.ts uses `(stats as any)[row.status]` | Auto-fixed — typed key narrowing |
| 2 | LOW | `planNextTask()` called in multi-agent mode but result unused — wasted LLM call | Auto-fixed — deferred to single-agent path |
| 3 | LOW | `merge-agent.ts` imports `LLMProvider` but unused by `sweep()` | Accepted — future-facing for summary compression |

## Self-Heal Actions
- `be508b5` fix: harden review — remove as-any in peek(), defer planNextTask to single-agent path, add enqueueFromThreads tests

## Test Coverage
- Tests added: 3 (enqueueFromThreads in project-orchestrator.test.ts)
- Full suite: 283/283 (30 suites, zero failures)
- Typecheck: clean

## New Components in This Story
- `TaskQueue` — SQLite WAL, atomic BEGIN IMMEDIATE claim, depends_on via json_each, staleCheck (14 tests)
- `mergePackets()` — Pure function, 10 merge rules, 3 never-drop fields (13 tests)
- `MergeAgent.sweep()` — Async lockfile-guarded directory sweep (3 tests)
- `MemoryPacket v2` — Entity, VocabularyEntry, SessionMeta optional fields (21 tests)
- `EBAPipeline` — activeTaskPath + pendingMergeDir config extensions
- `run.ts` — Multi-agent orchestration loop (EBA_MULTI_AGENT=true)
- `ProjectOrchestrator.enqueueFromThreads()` — Queue seeding from open threads (3 tests)

## Solutions Extracted
- Atomic SQLite claim with BEGIN IMMEDIATE
- staleCheck with JavaScript Date math (not SQLite datetime)
- Advisory lockfile for non-DB concurrency

## Escalations
- None
