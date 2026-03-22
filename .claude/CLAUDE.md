# Episodic Blueprint Architecture (EBA)

> Read D:/SYSTEM.md first. It overrides everything below.

## Stack
- TypeScript 5.x, Node.js 20+
- Multi-model AI: Anthropic SDK, OpenAI, Google Generative AI
- SQLite via better-sqlite3
- Jest 29 (ts-jest)

## Commands
```bash
npm run build    # Compile TypeScript
npm run test     # Jest test suite
npm run lint     # ESLint
npm start        # Run system
```

## Architecture
- Autonomous AI engineering system with episodic memory
- Deterministic orchestration + isolated execution threads
- Multi-model safety validation layer

## Project-Specific Rules
- Multi-model: never hardcode a single provider — use abstraction layer
- Episodic memory is SQLite-backed; schema changes require migration

## Gotchas
- proper-lockfile used for file-based concurrency — do not remove
- API keys required for all three providers (Anthropic, OpenAI, Google)

## Active Work
None currently.
