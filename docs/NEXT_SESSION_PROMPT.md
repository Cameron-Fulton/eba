# EBA — Next Session Bootstrap

## Quick Start
```
Read memory/INDEX.md then load memory/mp-005-20260323-target-aware-toolshed-and-nk-promotion.md
```

## System State (as of 2026-03-23)
- **Branch:** `main` (clean, all work merged)
- **Tests:** 366 passing across 37 suites, 0 failures
- **Typecheck:** Clean (tsc --noEmit passes)
- **Lifecycle:** /harden passed for target-aware-toolshed + NK promotion

## What Was Accomplished This Session
1. **Target-aware tool-shed** — ToolShedConfig refactor, segment-based command blocklist (with subshell/backtick defense), custom allowlist per project, grep_search/glob_find path validation, test_runner delegation, dual NK stores with project-first search, .eba/ artifact directories, Windows case-insensitive path checks
2. **NK promotion** — NKPromoter class with generalizability scoring (0-100 clamped), regex-based generalization (path stripping, framework file preservation), cold start safeguard (unvalidated + votes:0), dedup ledger (promoted_ids.json), librarian intake file writing, pipeline integration (success-only gate)
3. **/harden** — CodeRabbit review found 3 HIGH + 6 MEDIUM; all HIGHs auto-fixed (cwd propagation, subshell blocking, basename blocklist), 4 MEDIUMs auto-fixed, 6 new security tests added

## What's Next

**Highest value next steps (pick one):**

1. **NK vote incrementing** — The validation half of the cold start safeguard. Requires PromptEnhancer to track which NK entries were injected into a prompt and whether the task succeeded. When a promoted entry helps solve a task on a different project, increment its vote count. This closes the feedback loop.

2. **Multi-agent target awareness** — The multi-agent mode still hardcodes ROOT_DIR. Extend it to support targetProjectDir so parallel agents can work on external projects.

3. **Adversarial command defense** — Current subshell/backtick blocking is regex-based. A lightweight shell tokenizer would provide stronger guarantees against command injection.

## Key Decisions (settled — don't re-litigate)
- ToolShedConfig-only constructor, no backward-compat string overload
- Segment-based blocklist with subshell defense (not full shell parser)
- Copy-with-generalization for NK promotion (project keeps exact, global gets abstracted)
- Cold start: unvalidated + votes:0 on all automated promotions
- Regex-only generalization (no LLM calls)
- Local dedup ledger (promoted_ids.json) over intake-dir scanning
- Framework-convention filenames preserved during generalization
- LIBRARIAN_INTAKE_DIR env var for configurable intake path

## Key Files
- `src/phase2/tool-shed.ts` — ToolShedConfig, blocklist, allowlist, search validation, test_runner
- `src/pipeline/nk-promoter.ts` — NKPromoter (score, generalize, promote)
- `src/pipeline/eba-pipeline.ts` — Dual NK wiring, promotion hook
- `src/pipeline/prompt-enhancer.ts` — Project-first NK search
- `src/pipeline/context-discovery.ts` — EbaConfig from .eba.json
- `src/run.ts` — Integration wiring for all features
- `docs/superpowers/specs/2026-03-23-target-aware-toolshed-design.md`
- `docs/superpowers/specs/2026-03-23-nk-promotion-design.md`
