# Harden Report — Target-Aware Tool-Shed + NK Promotion

**Date:** 2026-03-23
**Commits:** 94492e9..55a7bce
**Files changed:** 13 source/test files, 1144 lines added
**Reviewer:** coderabbit

## Findings

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | HIGH | `bash_execute` passes raw `cwd` instead of validated `effectiveCwd` to execSync | auto-fixed |
| 2 | HIGH | Shell operator splitting bypassable via `$()`, backticks, newlines | auto-fixed (block these patterns) |
| 3 | HIGH | Blocklist bypassable via absolute path to command (`/bin/rm`) | auto-fixed (extract basename) |
| 4 | MEDIUM | NK prompt dedup gap (project + global stores may overlap) | documented (future) |
| 5 | MEDIUM | `intakeDir` path traversal check case-sensitive on Windows | documented (low exploitability — filename constructed by code) |
| 6 | MEDIUM | `ebaConfig` fields not type-validated from .eba.json | auto-fixed (typeof guards) |
| 7 | MEDIUM | Unused `FILE_EXTENSIONS` constant (dead code) | auto-fixed (removed) |
| 8 | MEDIUM | TOCTOU in `.eba/` directory creation | auto-fixed (idempotent mkdirSync) |
| 9 | MEDIUM | Hardcoded Windows path for librarian intake default | documented (env var available) |
| 10 | LOW | `score()` asymmetry in path penalty (solution vs combinedText) | documented |
| 11 | LOW | Allowlist trailing-space convention fragile | documented |
| 12 | LOW | `stripFilenames` may match version-like terms | documented |
| 13 | LOW | Integration test for `.eba/` doesn't exercise production code | documented |

## Self-Heal Actions
- `dc3054f` fix: harden review — cwd propagation, subshell blocking, basename blocklist, type validation
- `55a7bce` test: add security guard coverage — subshell blocking, cwd validation, basename blocklist

## Test Coverage
- Tests added: 6 security guard tests (this harden pass) + 45 feature tests (implementation)
- Full suite: 366/366 passed

## Solutions Extracted

### Segment-based command blocklist with subshell defense
```typescript
// Block subshell expansion patterns before splitting
if (/\$\(|`|\n/.test(command)) { return error; }
// Split on shell operators, check each segment
const segments = command.split(/\s*(?:&&|\|\||;|\|)\s*/);
for (const segment of segments) {
  const firstToken = segment.trim().split(/\s+/)[0];
  const basename = firstToken.split(/[/\\]/).pop() ?? firstToken;
  if (BLOCKED_COMMANDS.has(basename)) { return error; }
}
```
*Source: dc3054f (2026-03-23) — tool-shed command validation pipeline*

### Cold start safeguard for automated knowledge promotion
Tag auto-promoted entries as `unvalidated` with `votes: 0`. Separate `originalTags` from provenance tags in the generalized entry to keep the intake markdown clean. Use a local `promoted_ids.json` ledger for deduplication instead of scanning the intake directory (immune to race conditions with the librarian process).
*Source: 341fdfd (2026-03-23) — NK promotion design decision*

## Escalations
- None
