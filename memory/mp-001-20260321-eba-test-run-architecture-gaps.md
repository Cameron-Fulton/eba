**MEMORY PACKET — mp-001 | 20260321 | eba-test-run-architecture-gaps**
**Parent:** —

**Goal:** Validate EBA as an autonomous systems engineer — not just a code-writing test-passer — capable of handling infrastructure audits, D: drive organization, and multi-agent concurrent execution for a unified dev environment.

**Context:** First live test of EBA pipeline against a non-coding task (D: drive audit/reorganization). Exposed 4 architectural gaps that have since been partially addressed; multi-agent concurrency remains unbuilt (session date: 2026-03-21).

**User Profile:** Senior technical user building a unified AI dev environment across Claude Code, Slate, and Gemini. Prefers direct answers, deeply versed in agentic architecture research. Values simplicity, self-healing systems, and "build on 1st attempt" quality.

**Entities Discussed:**
- EBA — Episodic Blueprint Architecture: autonomous AI engineering system with 4-phase pipeline (memory → orchestration → threading → validation)
- SOP Engine — Step-graph workflow controller that restricts tool access per step; 10 predefined code-centric SOPs
- Three-Pillar Model (3PM) — Risk gating system (transparency/accountability/trustworthiness) with per-action approval; distinct from SOPs
- Tool-Coordination Trade-off — Mathematical finding that giving LLMs 16+ tools causes reasoning collapse; bounded 2-4 tool sets preserve performance
- Ad-Hoc Blueprint Engine — Proposed pattern: dynamically generate single-use SOPs at runtime with filtered toolsets instead of forcing predefined workflows
- Kamakazi Scout — Pre-flight probe pattern for non-coding tasks; generates pitfalls.md as negative knowledge
- ProjectOrchestrator — EBA component that reads memory packets and auto-selects next task; overwrites ACTIVE_TASK.md (single-tenant flaw)
- Merge Agent — Proposed consolidation agent for parallel memory packets; accumulates rejections, later decisions override earlier ones
- Negative Knowledge (NK) — Failed approaches stored in docs/solutions/; prevents repeating mistakes across sessions
- better-sqlite3 — Native SQLite binding broken due to Win32 ABI mismatch; blocks test suite entirely

**Decisions Made (ranked by priority):**
1. Build SQLite task queue with claim/release semantics — ADOPT FIRST — replaces fragile single ACTIVE_TASK.md for multi-agent support
2. Implement per-agent isolated task files (ACTIVE_TASK_{id}.md) — ADOPT — threads stop overwriting each other's state
3. Build Merge Agent for parallel memory packet consolidation — ADOPT — strict rules: NK accumulates, later decisions override, artifacts grow
4. Add Kamakazi infrastructure probe SOP — ADOPT — already implemented; relaxes bash/glob permissions for non-coding tasks
5. Dynamic success gates per task type — ADOPT — already implemented; validation_report.md for probes instead of hardcoded npm test
6. Task classifier in orchestrator (coding vs non-coding) — ADOPT — already implemented; routes to appropriate SOP
7. SOPs serve cognitive bounding, not safety — CAUTIOUS — SOPs limit action space to prevent LLM reasoning collapse; 3PM handles environment safety separately
8. VS Code extension integration — DEFER — scoped but deprioritized until multi-agent architecture is solid

**Rejected (with reasoning):**
- Full tool access with 3PM-only safety — causes LLM reasoning collapse per tool-coordination trade-off research
- Single ACTIVE_TASK.md for concurrent agents — race conditions, silent data loss from overwrites
- Advisory-only SOPs — removes cognitive bounding that prevents hallucination in tool-heavy tasks
- Running EBA concurrently without task queue — agents duplicate work and corrupt shared state

**Critical Risks Identified:**
- better-sqlite3 ABI mismatch blocks entire test suite — requires npm rebuild or environment fix; all coding tasks fail at test gate until resolved
- API keys exposed in .env.local during session — visible in tool output; rotate or restrict file read permissions
- Memory packet overwrite in parallel execution — without Merge Agent, latest-writer-wins destroys prior agent's findings

**Open Threads:**
- Multi-agent architecture — SQLite task queue, per-agent task isolation, and Merge Agent are designed but NOT yet built. This is the immediate next build target.
- D: drive organization — original task that triggered this session; blocked pending EBA capability upgrades. Need to re-run once multi-agent + probe SOP are solid.
- VS Code extension — scoped (task UI, 3PM approval dialogs, trust progression, concurrent sessions) but deferred until core architecture stabilizes.
