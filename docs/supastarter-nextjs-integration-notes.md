# Supastarter Next.js Integration Notes

> Analysis date: 2026-03-15
> Supastarter fork: `Cameron-Fulton/supastarter-nextjs` (at commit `e6b81f1a`, ahead of upstream `v3.0.2`)

## Supastarter Assets Ready for EBA

| Asset | Details |
|---|---|
| **`@repo/agents`** package | Empty placeholder — exists specifically for agentic AI integration |
| **`@repo/ai`** package | Vercel AI SDK wrapper, streaming support, OpenAI providers configured |
| **AI chat UI** (`apps/saas/modules/ai/components/AiChat.tsx`) | Working streaming chat with message history, auto-scroll, error handling |
| **`/api/rpc/ai/stream`** endpoint | Protected streaming endpoint with auth context (oRPC EventIterator) |
| **Prisma + PostgreSQL** | User/org context available for multi-tenant agent sessions |
| **oRPC (Hono)** | Type-safe API layer, easy to add new procedures via `protectedProcedure` |
| **`@repo/storage`** | S3-based file storage (AWS/MinIO) — available for agent artifacts |

## Tech Stack Overlap

- Both projects are **TypeScript**
- Both use **AI providers**: Anthropic, OpenAI, Google (EBA uses all three natively; Supastarter currently uses OpenAI via Vercel AI SDK)
- Both target **Node.js** runtime
- Supastarter is a **pnpm monorepo with Turbo** — EBA's core logic could live in `@repo/agents`

## Compatibility: Good Fit

- EBA's `EBAPipeline` can be wrapped as an oRPC procedure behind existing auth middleware
- The AI chat UI already handles streaming — EBA responses can feed into it
- EBA's per-session memory could be scoped per-user/per-org using Supastarter's auth context
- EBA's multi-model routing (Claude/Gemini/GPT-4o) aligns with Supastarter's AI package patterns

## Compatibility: Friction Points

### 1. SQLite vs PostgreSQL
- **EBA** uses `better-sqlite3` for its hybrid retrieval index (BM25 + vector search)
- **Supastarter** uses PostgreSQL via Prisma
- **Options:** Keep SQLite as a sidecar, or port EBA's index to Postgres (`pgvector` + `pg_trgm` can replicate BM25 + vector hybrid)

### 2. CLI/Batch vs Request-Response
- EBA runs as a long-running process (`npm start`, reads `ACTIVE_TASK.md`)
- Designed as a CLI/batch tool, not a web service
- **Needs:** Request handlers with session management to serve web requests

### 3. Filesystem-Based State
- EBA's truth source is markdown files: `ACTIVE_TASK.md`, `docs/logs/`, `docs/memory-packets/`, `docs/solutions/`
- This doesn't map to a multi-tenant web app
- **Needs:** State migrated to database or object storage (`@repo/storage` has S3 ready)

### 4. Worker Threads in Web Context
- EBA spawns Node.js worker threads for isolated execution
- Works fine in a persistent Node.js process, but needs careful lifecycle management in serverless/edge (Next.js API routes)
- **Needs:** Dedicated Node.js service, or careful thread pool management

### 5. No Web API Surface
- EBA has no HTTP endpoints, WebSocket handlers, or event emitters
- The integration layer between EBA and Supastarter needs to be built from scratch

## Architecture Options

### Option 1: Sidecar Service
Run EBA as a separate Node.js process, expose via HTTP/WebSocket, call from Supastarter's API layer.
- **Pro:** Cleanest separation, easiest to develop independently, no EBA refactoring needed
- **Con:** Additional deployment/ops complexity, network hop latency

### Option 2: Package Integration
Import EBA's core modules into `@repo/agents`, swap filesystem state for database-backed state, wire into oRPC.
- **Pro:** Tightest integration, single deployment, shared types
- **Con:** Requires significant refactoring of EBA's state layer

### Option 3: Queue-Based
Supastarter submits tasks to a queue, EBA processes async, results stream back.
- **Pro:** Fits EBA's "read task -> execute -> return episode" pattern naturally, handles long-running tasks well
- **Con:** More infrastructure (queue service), eventual consistency in UI

## Key Supastarter Entry Points for Integration

| File | Purpose |
|---|---|
| `packages/agents/` | Where EBA logic should live |
| `packages/api/modules/ai/router.ts` | Add new agent-specific oRPC procedures |
| `packages/ai/index.ts` | AI provider configuration |
| `apps/saas/modules/ai/components/AiChat.tsx` | Frontend chat UI to extend |
| `packages/api/orpc/router.ts` | Main API router (mount agent routes here) |
| `packages/database/` | Prisma schema for agent state tables |

## Database Context Available from Supastarter

- User model: id, name, email, role, locale, organization context
- Organization model with members/ownership
- Session context with `activeOrganizationId`
- Auth via Better-auth (OAuth, passkeys, 2FA)
