# Harden Report — Task nk-vote-incrementing: NK Vote Incrementing

**Date:** 2026-03-24
**Commits:** bbebe41..HEAD (12 commits)
**Files changed:** 14 (7 source + 7 test)
**Reviewer:** coderabbit

## Findings

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| H1 | HIGH | `context_keys.sort()` mutates receipt arrays in mergePackets dedup | auto-fixed |
| H2 | HIGH | `applyVoteReceipts` passes full entry to `store.update()`, violating type contract | auto-fixed |
| M1 | MEDIUM | `resolveWilsonScore` _default has no minimum-attempts guard | documented as intentional per spec |
| M2 | MEDIUM | `toIntakeMarkdown` still outputs vestigial `votes: 0` in frontmatter | auto-fixed |
| M3 | MEDIUM | `enhance()` overwrites `injectedNkEntries` on each call (multi-turn loss) | auto-fixed (accumulate + dedup) |
| M4 | MEDIUM | `buildContextKeys` compound missing Set dedup per spec | auto-fixed |
| L1 | LOW | Vote metrics regex allows keys containing `: ` | accepted (system-generated data) |
| L2 | LOW | `getInjectedNkEntries` shallow copy | accepted (consumer is read-only) |
| L3 | LOW | No `successes <= total_attempts` invariant validation | accepted (system-generated data) |
| L4 | LOW | `toIntakeMarkdown` doesn't emit vote_metrics | accepted (ingest path uses entry object) |

## Self-Heal Actions
- `fix: harden H1 — avoid sort() mutation in mergePackets dedup`
- `fix: harden H2 — pass only vote_metrics to store.update()`
- `fix: harden M2 — remove vestigial votes:0 from intake frontmatter`
- `fix: harden M3 — accumulate injected NK entries across enhance() calls`
- `fix: harden M4 — Set dedup on compound key tags per spec`
- `fix: harden M1 — document _default fallback has no minimum-attempts gate`

## Test Coverage
- Tests added: 74 (366 → 440)
- Full suite: 440/440 passing
- Typecheck: clean

## Solutions Extracted
- Wilson Score Lower Bound for vote ranking with fallback chain
- Lock-free vote receipt pattern for multi-agent concurrency
- Tiered compound context key construction (ambient noise filtering)

## Escalations
- None
