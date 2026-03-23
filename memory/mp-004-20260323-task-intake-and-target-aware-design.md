**MEMORY PACKET — mp-004 | 20260323 | task-intake-and-target-aware-design**
**Parent:** mp-003

**Goal:** Make EBA usable as an external tool — any human or system can dispatch tasks to EBA, and EBA can read/write files in the target project, not just its own codebase.

**Context:** Built the task intake system (CLI arg, file drop zone, context discovery) and designed the target-aware tool-shed spec. Intake is merged to main; tool-shed is spec-only, ready for implementation. Session covered brainstorming, spec writing, subagent-driven implementation (9 tasks), /harden review, and the target-aware design. (2026-03-22 to 2026-03-23)

**Entities Discussed:**
- TaskIntake — file drop zone at `docs/task-intake/`, .md files with YAML frontmatter priority, atomic `.claiming` rename, `processed/` and `failed/` disposition
- ContextDiscovery — auto-reads SYSTEM.md/CLAUDE.md/AGENTS.md from target project, parses markdown file references, fallback .md scan, 50K char truncation, path traversal guard via `isWithinProject()`
- PromptEnhancer.projectContext — new field, injected at prompt start (before SOP/tools/NK), addresses lost-in-the-middle effect
- Priority chain in run.ts — CLI arg > intake file > orchestrator > ACTIVE_TASK.md fallback
- `.eba.json` — optional config in target project root: `test_command`, `project_name`, `context[]`, `allowed_commands[]`
- `.eba/` directory — target project artifact storage: `solutions/`, `memory-packets/`, `logs/`. Solutions committed, logs/packets gitignored.
- ToolShedConfig — new config object replacing positional constructor args, adds `allowedPrefixes`, `testCommand`
- Segment-based blocklist — splits commands on `&&`/`||`/`;`/`|`, checks first token per segment against immutable blocklist. Guards against accidental LLM destruction, not adversarial input.
- `/eba` skill — `~/.claude/skills/eba/SKILL.md`, resolves EBA_HOME, runs `npx ts-node src/run.ts "<task>"` from any project
- Dual NK stores — separate global (EBA home) and project (`.eba/solutions/`) stores, project-first search strategy

**Decisions Made (ranked by priority):**
1. Task intake system with two paths (CLI + drop zone) — ADOPT FIRST — shipped and merged, 315 tests passing
2. `.eba/` dotfolder for target project artifacts — ADOPT — clean namespace, won't collide, solutions committed / logs gitignored
3. Single tool-shed scope (target project only, no dual EBA+target) — ADOPT — EBA loads its own NK/context at boot, tool-shed doesn't need to reach back
4. Command allowlist replacement (not merge) with `git` always included — ADOPT — prevents irrelevant Node tools in Python/Go projects while keeping git available
5. Segment-based blocklist matching — ADOPT — practical LLM safety without full shell parser
6. Project-first NK search — ADOPT — prevents project-specific failures from being diluted by global store
7. `grep_search`/`glob_find` path validation — ADOPT — currently unbounded, must validate against projectRoot

**Rejected (with reasoning):**
- Merged NK store — save provenance problem; separate stores keep project/global entries isolated
- Auto-detect allowed commands from project files — too magical, explicit `.eba.json` is safer
- `docs/eba/` for artifacts — could collide with existing project structure; `.eba/` dotfolder is cleaner
- `EBA_MANUAL_TASK` env var — superseded by the priority chain; was a temporary bandaid
- Adversarial command blocklist — out of scope; EBA is invoked by trusted users, LLM is the only command generator

**Critical Risks Identified:**
- Windows path case sensitivity in `isWithinProject` — fixed with `.toLowerCase()` but could resurface in other path comparisons
- test_runner tool hardcodes Jest — must delegate to configured test command or external projects always run Jest
- Monorepo `.eba/` placement — currently always at `targetProjectDir` root, may be wrong for `apps/web` subdirectories

**Open Threads:**
- Target-aware tool-shed implementation — spec approved at `docs/superpowers/specs/2026-03-23-target-aware-toolshed-design.md`, needs implementation plan (`/write-plan`) then subagent-driven execution. This is the feature that makes EBA actually useful on external projects.
- First real EBA test on external project — after tool-shed is target-aware, run `/eba` against supastarter-nextjs to validate the full flow end-to-end
