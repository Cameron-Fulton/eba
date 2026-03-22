# Harden Report — Story provider-hardening: GeminiProvider callWithTools, security hardening, audit fixes

**Date:** 2026-03-22
**Commits:** e8adcad..78336c0
**Files changed:** 37

## Findings

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | MEDIUM | GeminiProvider `functionResponse.name` used `tool_call_id` instead of function name — multi-turn tool calling would fail | Auto-fixed: added `callIdToFnName` map, resolves function name at response time |
| 2 | LOW | GeminiProvider tool call IDs used `Date.now()` instead of `crypto.randomUUID()` | Auto-fixed: switched to crypto.randomUUID() |
| 3 | LOW | patterns-reference.md: GeminiProvider listed as "call only" | Auto-fixed: updated to "call + callWithTools" |
| 4 | LOW | patterns-reference.md: SOP auto-selection said "9" instead of "10" | Auto-fixed: corrected to 10 |

## Self-Heal Actions
- `78336c0` fix: harden review — Gemini functionResponse name mapping, crypto UUIDs, docs drift

## Test Coverage
- Tests added: 0 (existing tests updated to match fixes)
- Full suite: 288/288 passed (31 suites)

## Solutions Extracted
- "Gemini functionResponse.name must be the function name, not the call ID" added to solutions.md

## Escalations
- None
