# Episodic Blueprint Architecture (EBA)

Autonomous AI engineering system that combines deterministic orchestration with episodic memory, isolated execution threads, and multi-model safety validation.

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Jest](https://img.shields.io/badge/Jest-29.x-C21325?logo=jest&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)

---

## 🧭 Overview

**EBA** is a layered architecture for long-running, autonomous software engineering workflows.

It is designed to address three recurring failure modes in AI coding systems:

- **Context rot**: long sessions lose key reasoning and decisions
- **Infinite loops**: retries repeat failed approaches without learning
- **Hallucination**: confident but incorrect solutions bypass validation

### Core Insight

Treat the LLM like an **OS kernel** inside a deterministic runtime:

- deterministic control flow handles task lifecycle, retries, safety, and persistence
- model calls are components inside a governed execution pipeline
- failures and decisions are externalized into durable memory for future runs

---

## 🏗️ Architecture

EBA is organized into 4 layers:

### Layer 1: Hybrid Memory & Context Engine
**What it does:** preserves learning and reconstructs context efficiently.

- **Memory Packets** (`memory-packet.ts`): compress session transcripts into structured JSON summaries
- **Negative Knowledge** (`negative-knowledge.ts`): stores failed approaches (scenario → attempt → outcome → solution)
- **SQLite AI Index** (`ai-index.ts`): supports retrieval from derived artifacts for context grounding

### Layer 2: Blueprint Orchestrator
**What it does:** runs deterministic execution around model reasoning.

- **Blueprint Orchestrator** (`orchestrator.ts`): drives attempts, testing, and logging
- **Ralph Wiggum loop**: kill-and-restart retry pattern to avoid degraded in-memory loops
- **SOP Engine** (`sop.ts`): formal step graph controlling progression and tool eligibility

### Layer 3: Episodic Thread Weaving
**What it does:** isolates reasoning and captures compact execution episodes.

- **Thread Manager** (`thread-manager.ts`): dispatches isolated task workers
- **Thread Executor** (`thread-executor.ts`): wraps attempt execution per thread
- **Tool Shed** (`tool-shed.ts`): curated, task-aware tool exposure
- **Episodes**: each thread returns compressed execution artifacts instead of raw full context

### Layer 4: Validation & Safety
**What it does:** adds consensus checks, proof hooks, and risk controls.

- **Consortium Voter** (`consortium-voter.ts`): parallel model voting + quorum similarity checks
- **Visual Proof System** (`visual-proof.ts`): post-test visual/report hooks
- **Three-Pillar Model** (`three-pillar-model.ts`): transparency/accountability/trustworthiness with HITL-compatible approval gating

---

## 🗂️ Project Structure

```text
.
├─ src/
│  ├─ phase1/
│  │  ├─ ai-index.ts
│  │  ├─ compression-agent.ts
│  │  ├─ memory-packet.ts
│  │  ├─ negative-knowledge.ts
│  │  └─ orchestrator.ts
│  ├─ phase2/
│  │  ├─ sop.ts
│  │  ├─ thread-executor.ts
│  │  ├─ thread-manager.ts
│  │  └─ tool-shed.ts
│  ├─ phase3/
│  │  ├─ consortium-voter.ts
│  │  ├─ three-pillar-model.ts
│  │  └─ visual-proof.ts
│  ├─ phase4/
│  │  ├─ arena-loop.ts
│  │  └─ parallel-negative-knowledge.ts
│  ├─ pipeline/
│  │  ├─ eba-pipeline.ts
│  │  └─ prompt-enhancer.ts
│  ├─ providers/
│  │  ├─ claude-provider.ts
│  │  ├─ gemini-provider.ts
│  │  ├─ openai-provider.ts
│  │  ├─ openrouter-provider.ts
│  │  └─ model-router.ts
│  ├─ run.ts
│  └─ run-arena.ts
├─ tests/
│  ├─ phase1/
│  ├─ phase2/
│  ├─ phase3/
│  ├─ phase4/
│  └─ pipeline/
├─ docs/
│  ├─ PROJECT.md
│  ├─ ACTIVE_TASK.md
│  ├─ logs/
│  ├─ memory-packets/
│  └─ solutions/
├─ package.json
└─ README.md
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js 20+**
- **npm**
- API keys for one or more model providers

### Installation

```bash
npm install
```

### Environment Setup

Create `.env.local` at repo root:

```bash
# Required by default run path
ANTHROPIC_API_KEY=your_anthropic_key
GOOGLE_API_KEY=your_google_key
OPENAI_API_KEY=your_openai_key

# Required only if PRIMARY_MODEL=openrouter
OPENROUTER_API_KEY=your_openrouter_key

# Optional: enables real coding benchmark scoring for OpenRouter complex tier
AA_API_KEY=your_artificial_analysis_key

# Optional runtime config
PRIMARY_MODEL=claude
TEST_COMMAND="npm test"
ARENA_OBJECTIVE=test_pass_rate
ARENA_MAX_ITER=10
ARENA_THRESHOLD=0.01
SOLUTIONS_DIR=docs/solutions
```

### Run the Pipeline

Default startup:

```bash
npm start
```

Run with explicit model + test command overrides:

```bash
PRIMARY_MODEL=openai TEST_COMMAND="npm test" npm run start
```

### Run the Arena Loop (Phase 4)

```bash
npx ts-node src/run-arena.ts
```

---

## ⚙️ Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes* | — | Anthropic API key (Claude providers) |
| `GOOGLE_API_KEY` | Yes* | — | Google API key (Gemini providers) |
| `OPENAI_API_KEY` | Yes* | — | OpenAI API key (GPT providers) |
| `OPENROUTER_API_KEY` | Conditional | — | Required when `PRIMARY_MODEL=openrouter` |
| `AA_API_KEY` | No | — | Artificial Analysis API key — enables real coding benchmark scores for OpenRouter complex-tier model selection; falls back to price-proxy heuristic if absent |
| `PRIMARY_MODEL` | No | `claude` | Primary model router target: `claude` \| `gemini` \| `openai` \| `openrouter` |
| `TEST_COMMAND` | No | `npm test` | Shell command used by orchestrator for verification |
| `ARENA_OBJECTIVE` | No | `test_pass_rate` | Objective name for Arena Loop optimization |
| `ARENA_MAX_ITER` | No | `10` | Maximum Arena Loop iterations |
| `ARENA_THRESHOLD` | No | `0.01` | Minimum improvement threshold to continue arena iterations |
| `SOLUTIONS_DIR` | No | `docs/solutions` | Path to negative knowledge markdown store |

\*Current `src/run.ts` validation expects Anthropic, Google, and OpenAI keys to be present for normal startup.

---

## 🔄 How It Works

A single EBA pipeline execution follows this lifecycle:

### 1) Pre-Task Phase

1. Load **Negative Knowledge** from `docs/solutions`
2. Start the configured **SOP** and initialize the first step
3. Wrap the selected provider with **PromptEnhancer** to inject:
   - negative knowledge context
   - current SOP state
   - tool-shed selected tools

### 2) During Task Execution

1. Dispatch task to **ThreadManager** as isolated attempts
2. Execute each attempt through orchestrator logic and test runner
3. Apply **Ralph Wiggum retry behavior** (reset + retry on failures)
4. If repeated failures persist, request **consortium escalation** (3PM-gated)
5. Record transitions and decisions through the **Three-Pillar Model**

### 3) Post-Task Phase

1. Persist failed attempts into **Negative Knowledge Store**
2. Compress transcript into a **Memory Packet** via CompressionAgent
3. Write packet to `docs/memory-packets/<session_id>.json`
4. Emit final status (`success` / `failure`) with attempt logs and session metadata

---

## 🧩 Configuration

`EBAPipeline` is configured using `EBAPipelineConfig`:

| Option | Type | Description |
|---|---|---|
| `docsDir` | `string` | Directory containing `ACTIVE_TASK.md` and `PROJECT.md` |
| `logsDir` | `string` | Directory where execution logs are written |
| `packetsDir` | `string` | Directory for memory packet JSON outputs |
| `solutionsDir` | `string` | Directory for negative knowledge markdown files |
| `primaryProvider` | `LLMProvider` | Main provider for coding/execution attempts |
| `routineProvider` | `LLMProvider` | Lower-cost provider for compression and routine tasks |
| `consortiumVoter` | `ConsortiumVoter` | Multi-model voter used for escalation/consensus |
| `sop` | `SOPEngine` | SOP engine instance with registered SOP graphs |
| `sopId` | `string` | SOP id to execute for this run |
| `toolShed` | `ToolShed` | Tool registry + selector for task-scoped tool access |
| `threePillar` | `ThreePillarModel` | Risk/approval and state transition framework |
| `testRunner` | `OrchestratorConfig['testRunner']` | Verification runner (typically shell test command) |
| `maxRetries?` | `number` | Max attempts before pipeline stops (default: `3`) |
| `contextSaturationThreshold?` | `number` | Token threshold for context saturation logic (default: `50000`) |
| `sessionId?` | `string` | Optional explicit session id; auto-generated when omitted |
| `visualProofSystem?` | `VisualProofSystem` | Optional post-test proof hook system |
| `visualProofOutputPath?` | `string` | Optional markdown output path for proof report |
| `approvalMode?` | `'dev' \| 'strict' \| 'configurable'` | 3PM approval behavior |
| `threadManagerConfig?` | `{ timeout_ms: number; max_concurrent: number; maxEpisodeHistory?: number }` | Thread manager execution controls |

---

## 🧪 Testing

Run the full suite:

```bash
npm test
```

Run integration tests only:

```bash
npx jest tests/pipeline/eba-pipeline.integration.test.ts
```

Coverage scope includes all four architecture phases plus pipeline/provider utilities, with an integration suite validating end-to-end phase composition (targeted as **22 unit test files across all 4 phases + 1 integration suite**).

---

## 🤖 Model Tiers

Model routing is provider-aware by complexity tier:

| Provider | Routine | Standard | Complex |
|---|---|---|---|
| **Claude** | `claude-haiku-3-5-20241022` | `claude-3-5-sonnet-20241022` | `claude-opus-4-5` |
| **Gemini** | `gemini-2.5-flash` | `gemini-2.5-flash` | `gemini-2.5-flash` *(no separate complex tier configured)* |
| **OpenAI** | `gpt-4o-mini` | `gpt-4o` | `gpt-4o` |
| **OpenRouter** | `qwen/qwen3-coder` | `minimax/minimax-m2.5` | `moonshotai/kimi-k2-thinking` |

> Consortium voting currently uses Claude complex + Gemini standard + OpenAI standard providers.

---

## 🛠️ Contributing / Development

When extending the system, follow the phase boundaries and existing conventions:

- **Add SOPs** in `src/phase2/sop.ts` (or adjacent SOP modules), then register in startup flow (`src/run.ts`)
- **Add providers** under `src/providers/` and wire selection logic in `model-router.ts`
- **Add Tool Shed tools** in `src/phase2/tool-shed.ts` with task-aware selection rules
- **Preserve deterministic orchestration** in `phase1/orchestrator.ts` and `pipeline/eba-pipeline.ts`
- **Back changes with tests** in the matching `tests/` subdirectory

For project-level task state and planning artifacts, see `docs/PROJECT.md` and `docs/ACTIVE_TASK.md`.
