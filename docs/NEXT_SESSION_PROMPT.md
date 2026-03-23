# EBA — Next Session Bootstrap

## Quick Start
```
Read memory/INDEX.md then load memory/mp-004-20260323-task-intake-and-target-aware-design.md
```

## System State (as of 2026-03-23)
- **Branch:** `main` (clean, all work merged)
- **Tests:** 315 passing across 35 suites, 0 failures
- **Typecheck:** Clean (tsc --noEmit passes)
- **Lifecycle:** /harden passed for task-intake feature

## What Was Accomplished This Session
1. Diagnosed EBA's closed-loop problem — no external task entry point
2. Built task intake system: CLI arg, file drop zone (`docs/task-intake/`), `/eba` skill
3. Built context discovery: auto-reads SYSTEM.md/CLAUDE.md/AGENTS.md from target project
4. Wired priority chain in run.ts: CLI arg > intake > orchestrator > fallback
5. Added projectContext injection to PromptEnhancer (placed first for lost-in-the-middle mitigation)
6. Security hardened: path traversal guards, CRLF normalization, TOCTOU race fix, Windows case sensitivity
7. Ran /harden — CodeRabbit review found 2 critical + 3 high issues, all resolved
8. Designed target-aware tool-shed spec — approved, ready for implementation

## What's Next
**Implement the target-aware tool-shed** so EBA can read/write files in external projects.

Spec: `docs/superpowers/specs/2026-03-23-target-aware-toolshed-design.md`

Steps:
1. Read the spec
2. Write implementation plan (`/write-plan`)
3. Execute with subagent-driven development

## Key Decisions (settled — don't re-litigate)
- Single tool-shed scope — target project only, no dual EBA+target access
- `.eba/` dotfolder for artifacts in target project (solutions committed, logs/packets gitignored)
- Command allowlist **replaces** defaults when `.eba.json` provides one; `git` always included
- Separate NK stores (global + project), project-first search
- Segment-based blocklist for accidental LLM destruction (not adversarial defense)
- `grep_search`/`glob_find` must validate paths against projectRoot
- `test_runner` delegates to configured command; filter param ignored for non-Jest

## Key Files
- `src/run.ts` — CLI entry point with priority chain
- `src/pipeline/task-intake.ts` — File drop zone with priority sorting
- `src/pipeline/context-discovery.ts` — Project context auto-reader
- `src/phase2/tool-shed.ts` — Tool registry (needs target-aware refactor)
- `docs/superpowers/specs/2026-03-23-target-aware-toolshed-design.md` — The spec to implement
- `~/.claude/skills/eba/SKILL.md` — The /eba skill
