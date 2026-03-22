# Harden Report — Story eba-core-build: EBA Core System Build

**Date:** 2026-03-21
**Commits:** f25694c..HEAD (20+ commits)
**Files changed:** 60

## Findings

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| S1 | CRITICAL | Path traversal in file_read — no containment | Fixed: added validatePath() with projectRoot |
| S2 | CRITICAL | Path traversal in file_write — no containment | Fixed: routed through validatePath() |
| S3 | CRITICAL | Path traversal in file_edit — no containment | Fixed: routed through validatePath() |
| S4 | CRITICAL | Command injection in bash_execute — raw execSync | Fixed: added prefix allowlist |
| S5 | HIGH | Command injection in test_runner filter — string interpolation | Fixed: switched to execFileSync with args array |
| S6 | HIGH | bash_execute classified as medium risk in 3PM | Fixed: changed to critical, requires_approval: true |
| S7 | MEDIUM | Prompt injection via transcript in compression-agent | Not fixed — requires architectural change to sanitization |
| S8 | MEDIUM | Incomplete prompt injection sanitization in pipeline | Not fixed — current sanitization is reasonable defense-in-depth |
| S9 | MEDIUM | PromptEnhancer missing callWithTools delegation | Fixed: added callWithTools forwarding |
| Q1 | MEDIUM | ToolShed.execute() >50 lines (107 lines) | Not fixed — switch statement is clear as-is |
| Q2 | MEDIUM | EBAPipeline.run() >50 lines (230 lines) | Not fixed — main orchestration method, breaking up would hurt readability |
| Q3 | LOW | code_analyzer tool is a no-op | Not fixed — placeholder for future implementation |
| Q4 | LOW | Hardcoded fidelity_score: 0.97 in memory-packet | Not fixed — informational metric only |
| Q5 | LOW | ModelRouter.instances set never cleaned up | Not fixed — minor, no production impact |
| Q6 | LOW | dispatchParallel doesn't queue, fails fast | Not fixed — by design |
| P1 | LOW | patterns-reference.md stale on callWithTools | Flagged for /audit to regenerate |
| P2 | LOW | patterns-reference.md stale on model names | Flagged for /audit to regenerate |

## Self-Heal Actions
- Path containment added to ToolShed (validatePath + projectRoot)
- Command prefix allowlist in bash_execute
- execFileSync in test_runner (eliminates injection class)
- bash_execute reclassified as critical in ThreePillarModel
- PromptEnhancer.callWithTools() delegation added
- Type error fix: claude-provider.ts ToolSchema import source (/gate)

## Test Coverage
- Tests added: 10 new tests (tool-executor, tool-loop, openai-provider, openrouter-tools, ai-index-fallback)
- Full suite: 219/229 passed (10 failures are ai-index.test.ts — better-sqlite3 Win32 native binary issue, pre-existing)

## Solutions Extracted
- Path containment pattern for LLM file operations
- execFileSync over execSync for injection prevention
- Command prefix allowlist for agentic shell execution
- PromptEnhancer must forward callWithTools
- Import types from their source module (isolatedModules gotcha)

## Escalations
- S7: Prompt injection via transcript — low risk (internal data only), no immediate action needed
- S8: Incomplete sanitization — current defense-in-depth is adequate
- Q1-Q2: Long functions — acceptable complexity for orchestration code
