**MEMORY PACKET — mp-002 | 20260321 | multi-agent-architecture-built**
**Parent:** mp-001

**Goal:** Build EBA into an autonomous multi-agent system capable of running parallel workers across processes and cloud sandboxes, with cross-process safe task coordination and lossless memory consolidation — the infrastructure layer that transforms EBA from a single-tenant pipeline into a distributed engineering team.

**Context:** Full implementation session delivering the multi-agent architecture designed in mp-001's open threads. All 8 tasks completed, reviewed, hardened, and PR'd in a single session (2026-03-21). Branch `feat/multi-agent-architecture` merged via PR #1.

**User Profile:** Senior technical user building unified AI dev environment (Claude Code + Slate + Gemini). Deeply versed in agentic architecture research (tool-coordination trade-offs, Open-SWE patterns). Thinks in OS/kernel analogies. Values "build on 1st attempt" quality and strict review discipline.

**Entities Discussed:**
- EBA — Episodic Blueprint Architecture: 4-phase autonomous AI engineering pipeline (memory → orchestration → threading → validation)
- TaskQueue — New SQLite WAL-mode task queue with atomic BEGIN IMMEDIATE claim, depends_on via json_each, stale recovery. File: `src/pipeline/task-queue.ts`
- MergeAgent — New memory consolidation system: pure `mergePackets()` (10 rules, 3 never-drop fields) + async `sweep()` with proper-lockfile. File: `src/pipeline/merge-agent.ts`
- MemoryPacket v2 — Schema extension adding Entity, VocabularyEntry, SessionMeta as optional fields for competitive landscape, domain vocabulary, and token budget tracking
- better-sqlite3 — Native SQLite binding; WAL mode provides true cross-process atomicity. ABI mismatch was resolved via `npm rebuild` during this session
- sql.js — Pure WASM SQLite driver; REJECTED because it has no WAL support, no file-level locking, no cross-process atomicity
- proper-lockfile — Advisory file lock npm package used for merge sweep concurrency (stale: 30s, retries: 0)
- Decomposability Check — Research-backed requirement that orchestrator must classify task dependencies before parallel dispatch; blindly parallelizing sequential tasks causes up to -70% quality degradation
- Option C deployment model — Single orchestrator spawning workers AND safe across multiple simultaneous orchestrator processes; chosen over pure in-process (A) or pure file-lock (B)
- Subagent-Driven Development — Execution methodology: fresh subagent per task + two-stage review (spec compliance then code quality) between each task

**Decisions Made (ranked by priority):**
1. Use better-sqlite3 with WAL mode for task queue — ADOPT FIRST — true cross-process atomicity, already a dependency; sql.js rejected (no WAL, no file locking)
2. Wrap claim() in BEGIN IMMEDIATE transaction — ADOPT — prevents two processes racing on SELECT; documented as cross-process safety requirement
3. mergePackets() as pure function separate from sweep() — ADOPT — pure function has zero mocks in tests; async I/O isolated to sweep()
4. Three never-drop fields: rejected_ideas, entities, vocabulary — ADOPT — these prevent context rot in parallel execution; merge agent must accumulate, never compress
5. depends_on column with json_each() prerequisite check — ADOPT — prevents catastrophic -70% degradation from parallelizing sequential tasks
6. Per-agent ACTIVE_TASK_{agentId}.md isolation — ADOPT — prevents context contamination between concurrent workers
7. pending_merge/ directory with lockfile sweep — ADOPT — decouples memory consolidation from task execution; audit trail via processed/ subdirectory
8. EBA_MULTI_AGENT=true opt-in flag — ADOPT — preserves backward-compatible single-agent mode as default
9. staleCheck uses JS Date math not SQLite datetime() — ADOPT — format mismatch between ISO 8601 and SQLite datetime caught in spec review

**Rejected (with reasoning):**
- sql.js for task queue — no WAL mode, no cross-process atomicity, in-memory only with manual serialization
- JSON file + advisory locks for queue — fragile under heavy concurrency, would need SQLite migration anyway
- Single ACTIVE_TASK.md for concurrent agents — race conditions, silent data loss from overwrites
- Synchronous sweep() — lockfile operations are async; LLM summary compression (future) requires async
- Item-level validation in MemoryPacket v2 — existing codebase doesn't deep-validate arrays; accepted as consistent design choice

**Critical Risks Identified:**
- Prepared statements not cached in TaskQueue — performance concern for high-throughput Arena Loop; not blocking but should be addressed before overnight runs
- No test for failed-prerequisite scenario — if a depends_on task fails, the dependent stays blocked silently forever unless manually released
- blocked() accepts both pending AND claimed status — broader than spec's state machine; acceptable but undocumented edge case

**Open Threads:**
- Arena Loop integration — TaskQueue + MergeAgent are built but not wired into arena-loop.ts for overnight parallel experiment runs
- Cloud sandbox dispatch — Modal/Daytona/EC2 integration deferred; local multi-agent infrastructure is ready
- CompressionAgent v2 — needs to populate session_meta.load_bearing_sections and token_budget_rationale during compression (spec criterion #8)
- VS Code extension — scoped (task UI, 3PM approval dialogs) but deferred until multi-agent is battle-tested
- Prepared statement caching — TaskQueue methods create new prepared statements per call; should cache as instance fields before Arena Loop stress testing
