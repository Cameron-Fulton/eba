**MEMORY PACKET — mp-005 | 20260323 | target-aware-toolshed-and-nk-promotion**
**Parent:** mp-004

**Goal:** Build an autonomous AI engineering system (EBA) that can work on any external project — reading/writing files, running tests, storing artifacts, and propagating learned failure patterns back to a global knowledge base for cross-project benefit.

**Context:** Implemented two major features: target-aware tool-shed (EBA operates on external projects with scoped file access, custom command allowlists, and .eba/ artifact storage) and NK promotion (automatically promotes generalizable failure solutions from project stores to global knowledge via librarian intake with cold start safeguards). Session date: 2026-03-23.

**Entities Discussed:**
- ToolShedConfig — config object replacing positional constructor args; carries projectRoot, allowedPrefixes, testCommand, approvalHandler
- Segment-based blocklist — splits commands on &&/||/;/|, checks each segment's first token against BLOCKED_COMMANDS set; also blocks $(), backticks, newlines
- NKPromoter — new class: score() heuristic (0-100 clamped), generalize() regex path-stripping, promote() with dedup ledger
- Cold start safeguard — promoted entries tagged unvalidated + votes:0; future sessions validate by incrementing votes (out of scope this session)
- promoted_ids.json — per-project dedup ledger in .eba/; immune to librarian race condition unlike intake-dir scanning
- GeneralizedEntry — intermediate type for abstracted NK entries; separates originalTags from provenance tags
- Dual NK stores — global (docs/solutions/) + project (.eba/solutions/); PromptEnhancer uses project-first search filling remaining slots from global
- .eba/ directory — artifact storage for external projects: solutions/, memory-packets/, logs/; .gitignore excludes logs+packets but commits solutions

**Decisions Made (ranked by priority):**
1. ToolShedConfig-only constructor (no backward-compat string overload) — ADOPT — cleaner API, all call sites updated atomically
2. Segment-based command validation with subshell defense — ADOPT — blocks $(), backticks, newlines; extracts basename for /bin/rm bypass prevention
3. Copy-with-generalization for NK promotion — ADOPT — project keeps exact version, global gets abstracted version via librarian intake
4. Cold start tagging (unvalidated + votes:0) — ADOPT — prevents automated noise from degrading global store quality
5. Regex-only generalization (no LLM calls) — ADOPT — keeps promotion synchronous, free, suitable for overnight Arena Loop runs
6. Local dedup ledger over intake-dir scanning — ADOPT — immune to librarian race condition
7. Framework-convention filename preservation — ADOPT — tsconfig.json, jest.config.ts etc. kept verbatim during generalization; userController.ts stripped
8. LIBRARIAN_INTAKE_DIR env var — ADOPT — configurable intake path, falls back to D:\_system\librarian\intake

**Rejected (with reasoning):**
- Backward-compat string overload — unnecessary complexity since all call sites updated together
- LLM-assisted generalization — too expensive for automated pipeline hook, regex sufficient for v1
- Intake-dir scanning for dedup — race condition with librarian moving files out
- Move semantics for promotion — project store loses local search relevance

**Critical Risks Identified:**
- SPECIFIC_FILENAME_PATTERN may false-positive on API calls like jest.mock (documented, low impact on scoring)
- Hardcoded Windows default for intake dir means promotion silently unavailable on Linux/macOS without env var
- Vote incrementing (the validation half of cold start) is unbuilt — promoted entries accumulate as unvalidated until that feature ships

**Open Threads:**
- Vote incrementing for NK validation — requires PromptEnhancer to track which NK entries were injected and whether task succeeded
- Multi-agent mode target awareness — multi-agent branch still hardcodes ROOT_DIR
- Adversarial command defense — subshell/backtick blocking added but full shell parser still out of scope
- Extract .eba/ scaffold logic into a testable utility function (currently inline in run.ts)
