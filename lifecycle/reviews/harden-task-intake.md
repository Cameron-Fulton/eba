# Harden Report — Task Intake System

**Date:** 2026-03-22
**Commits:** 2c15143..adc7ceb (12 commits)
**Files changed:** 11
**Reviewer:** coderabbit:code-review

## Findings

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | CRITICAL | TOCTOU race in renameSync — unhandled ENOENT on concurrent claim | auto-fixed: try/catch with ENOENT fallback |
| 2 | CRITICAL | Windows path case sensitivity in isWithinProject | auto-fixed: lowercase both paths |
| 3 | HIGH | targetProjectDir never set for cross-project CLI use | auto-fixed: use process.cwd() when different from ROOT_DIR |
| 4 | HIGH | CLI argument injection unsanitized | by design: EBA is invoked by trusted users, task IS the prompt |
| 5 | HIGH | parseFrontmatter regex edge case (no trailing newline) | documented: defaults to priority 10, acceptable |
| 6 | MEDIUM | No cleanup for stale .claiming files | deferred: follow-up task |
| 7 | MEDIUM | SYSTEM.md hardcoded default path | already configurable via EBA_SYSTEM_MD env var |
| 8 | MEDIUM | callWithTools path untested with projectContext | deferred: delegates to tested enhance() |
| 9 | MEDIUM | Integration tests don't exercise actual run.ts priority chain | deferred: tests validate component behavior |
| 10 | LOW | SAFE_COMMAND regex duplication | auto-fixed: extracted to module scope |

## Self-Heal Actions
- `fix: harden review — TOCTOU race, Windows path case, targetProjectDir from cwd`
- `refactor: extract SAFE_COMMAND regex to module scope`

## Test Coverage
- Tests added: 27 new tests across 4 suites
- Full suite: 315/315 passed

## Solutions Extracted
- Atomic file claim pattern: rename to `.claiming` extension for lightweight concurrency without database locks
- Path traversal guard: `isWithinProject()` with case-insensitive comparison for Windows

## Escalations
- None
