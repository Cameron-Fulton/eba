# EBA — Episodic Blueprint Architecture

Autonomous AI engineering system that treats the LLM like an OS kernel: deterministic code handles lifecycle, retries, safety, and persistence; model calls are components inside a governed execution pipeline.

## Quick orientation

- **Language:** TypeScript (Node 20+), Jest 29, ts-node
- **Run tests:** `npm test` (uses --runInBand --forceExit for WSL2 stability)
- **Type check:** `npm run lint` (tsc --noEmit)
- **Entry point:** `npx ts-node src/run.ts` — reads ACTIVE_TASK.md and executes it
- **Arena mode:** `npx ts-node src/run-arena.ts` — runs optimization loop

## Architecture (4 phases)

### Phase 1 — Memory & Orchestration
- `orchestrator.ts` — BlueprintOrchestrator, Ralph Wiggum retry loop, tool-calling loop
- `negative-knowledge.ts` — NegativeKnowledgeStore, prevents repeating failed approaches
- `ai-index.ts` — SQLite FTS5 index for fast NK retrieval
- `compression-agent.ts` — Compresses sessions into MemoryPackets (~3:1 ratio)
- `memory-packet.ts` — MemoryPacket schema and validation

### Phase 2 — SOPs & Threading
- `sop.ts` + `sop-library.ts` — 10 workflow SOPs (bug fix, feature, refactor, deploy, etc.)
- `thread-manager.ts` — Dispatches isolated worker threads, returns compressed Episodes
- `tool-shed.ts` — Tool registry with execute(), selectTools(), category/risk filtering

### Phase 3 — Validation & Safety
- `consortium-voter.ts` — Multi-model consensus (Claude + Gemini + GPT in parallel)
- `three-pillar-model.ts` — Risk gating: write/execute tools require approval
- `visual-proof.ts` — Post-success verification hooks, generates demo.md

### Phase 4 — Optimization
- `arena-loop.ts` — Iterative metric optimization, runs real tests as objective
- `parallel-negative-knowledge.ts` — Parallel failure avoidance across threads

### Pipeline
- `eba-pipeline.ts` — Full integration: NK → SOP → Orchestrator → Compression
- `project-orchestrator.ts` — Plans next task from memory packet open threads
- `prompt-enhancer.ts` — Injects NK + SOP context into every LLM prompt

### Providers
- `model-router.ts` — Routes by complexity: routine/standard/complex
- `claude-provider.ts` — Full callWithTools() via Anthropic tool_use API
- `openai-provider.ts` — Full callWithTools() via OpenAI function calling
- `openrouter-provider.ts` — Full callWithTools() via OpenAI-compatible API
- `benchmark-updater.ts` — Fetches live model benchmarks for OpenRouter tier selection

## Key env vars

```
ANTHROPIC_API_KEY   required
GOOGLE_API_KEY      required  
OPENAI_API_KEY      required
OPENROUTER_API_KEY  required only when PRIMARY_MODEL=openrouter
PRIMARY_MODEL       claude | gemini | openai | openrouter (default: claude)
TEST_COMMAND        shell command for verification (default: npm test)
```

Copy `.env.local.example` to `.env.local` and fill in keys.

## Current state

- 283 tests passing across 30 suites
- All 4 phases fully implemented including tool-calling loop
- SOP auto-selection: run.ts keyword-matches ACTIVE_TASK.md to pick the right SOP
- Security hardened: shell metacharacter guards, path validation, crypto UUIDs
- Active task: see docs/ACTIVE_TASK.md

## WSL2 note

Jest and ts-jest hang on NTFS mounts without `--runInBand`. Already applied:
- `tsconfig.json`: `isolatedModules: true`
- `package.json` test script: `jest --runInBand --forceExit`

Always use `npm test` rather than running jest directly.
