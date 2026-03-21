# Solutions — Patterns That Worked

> Curated by /harden, organized by /audit.
> Entries include source commit and context.

## Security

### Path containment for LLM-controlled file operations
Validate all file paths resolve inside the project root using `path.resolve()` + `startsWith()` before any `fs` operation. Applied to `file_read`, `file_write`, `file_edit` in `ToolShed.execute()`.
*Source: /harden eba-core-build (2026-03-21) — prevents LLM from reading/writing outside project root*

### Command injection prevention via execFileSync
Use `execFileSync` with an args array instead of `execSync` with string interpolation. Eliminates the entire class of shell injection. Applied to `test_runner` tool.
*Source: /harden eba-core-build (2026-03-21) — filter parameter was injectable via quote breakout*

### Command prefix allowlist for agentic shell execution
Only allow commands starting with known-safe prefixes (`npm`, `npx`, `jest`, `git`, `node`, `ts-node`, `tsc`). Hard-reject anything else before it reaches the shell.
*Source: /harden eba-core-build (2026-03-21) — prevents arbitrary command execution by LLM*

## Architecture

### PromptEnhancer must forward callWithTools
When wrapping an `LLMProvider` with a decorator, the decorator must implement `callWithTools()` — not just `call()`. Otherwise the tool-calling loop silently breaks because it checks `provider.callWithTools` and finds `undefined`.
*Source: /harden eba-core-build (2026-03-21) — decorator must forward callWithTools or tool loop silently breaks*

## Imports

### Import types from their source module
When `isolatedModules: true` + `strict: true`, import types from the module that defines them, not from a module that re-imports them internally. `ToolSchema` is defined in `phase2/tool-shed.ts`, not `phase1/orchestrator.ts`.
*Source: 0b988e7 /gate (2026-03-20) — isolatedModules + strict makes this a hard error*
