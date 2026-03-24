# NK Promotion: Project-to-Global Knowledge Propagation

**Date:** 2026-03-23
**Status:** Draft

## Problem

When EBA works on external projects, failed approaches and their solutions are
recorded to the project-specific NK store (`{project}/.eba/solutions/`). These
entries contain valuable patterns — "Jest mocks break when module uses ESM
re-exports" — but they're trapped in one project. Another project hitting the
same pattern gets no benefit.

The global NK store (`docs/solutions/`) has cross-project knowledge, but
nothing feeds project-specific discoveries back into it.

## Solution

After a successful pipeline run that recorded failures, scan the session's new
NK entries for promotion candidates. Entries that describe generalizable
patterns (framework bugs, library gotchas, tooling quirks) are copied to the
global store via the librarian intake drop zone. Project-specific entries (tied
to exact file paths, domain logic) are left in the project store only.

The project store retains the **exact, highly-specific version** with file
paths and error strings intact — local searches need maximum relevance. The
global copy is an **abstracted, generalized version** that strips project
paths and focuses on the framework or pattern. This prevents memory bloat in
the global store.

### Promotion flow

```
Pipeline succeeds with recorded failures
  → NKPromoter.evaluate(newEntries)
    → For each entry:
      1. Score generalizability (tag heuristic + path density)
      2. If score >= threshold → generalize → write to librarian intake
      3. If score < threshold → skip (stays project-only)
```

### Generalizability scoring

Each entry gets a score from 0-100. Threshold for promotion: **50**.

**Positive signals (add points):**
- Tags contain framework/tool names: `jest`, `typescript`, `react`, `node`,
  `webpack`, `prisma`, `docker`, `git`, `eslint`, `api`, `auth`, `oauth`,
  `cors`, `websocket`, `database`, `migration`, `cache` (+20 per match, max 40)
- Solution field contains a general pattern (no project-specific paths) (+20)
- Scenario describes a common operation: "test", "build", "deploy", "import",
  "configure", "install", "migrate" (+15)
- Entry has a successful solution (not "No successful solution found") (+15)

**Negative signals (subtract points):**
- Scenario or solution contains absolute paths (`/`, `C:\`, `D:\`) (-20)
- Scenario references specific filenames with extensions (`.ts`, `.js` etc.
  preceded by a project-specific name like `userController.ts`) (-15)
- Entry tagged `auto-recorded` only (no human-curated tags) (-10)

### Generalization step

Before writing to the global store, the entry is transformed:

1. **Strip project paths:** Replace absolute paths matching `{projectRoot}/*`
   with `{project}/...` or remove entirely
2. **Strip specific filenames:** Replace `src/controllers/userController.ts`
   with generic descriptions like "a controller file"
3. **Abstract error messages:** Keep the error type and key message, strip
   stack traces and line numbers
4. **Preserve the pattern:** Keep the scenario, the failed approach, why it
   failed, and what works — these are the valuable parts
5. **Add provenance tag:** Tag with `promoted`, source project name, and date

Example transformation:

**Project version (kept in `.eba/solutions/`):**
```
Scenario: Jest test for src/auth/tokenRefresh.ts fails with "Cannot use import
statement outside a module" when mocking @auth/core
Attempt: Used jest.mock('@auth/core') at top of test file
Outcome: ESM re-export in @auth/core breaks Jest's CommonJS mock hoisting
Solution: Add transformIgnorePatterns: ['node_modules/(?!@auth)'] to jest.config
Tags: jest, esm, auth, auto-recorded
```

**Global version (written to librarian intake):**
```
Scenario: Jest test fails with "Cannot use import statement outside a module"
when mocking an ESM package
Attempt: Used jest.mock() at top of test file
Outcome: ESM re-exports in the target package break Jest's CommonJS mock hoisting
Solution: Add transformIgnorePatterns to jest.config to transpile the ESM package
Tags: jest, esm, promoted, source:my-auth-app, promoted:2026-03-23
```

### Librarian intake format

Promoted entries are written to `D:\_system\librarian\intake\` as markdown
files following the existing intake format:

```markdown
---
source: eba-nk-promotion
project: {project_name from .eba.json or directory name}
date: {YYYY-MM-DD}
type: solution
---

## {Generalized scenario}

**Why this matters beyond one project:** {One sentence about the general pattern}

### Failed Approach
{Generalized attempt}

### Why It Failed
{Generalized outcome}

### What Works
{Generalized solution}

**Original tags:** {comma-separated tags}
**Promoted from:** {project name}
```

The librarian picks these up on its regular scan, processes them into
`D:\_system\knowledge\`, and they become available to all projects.

### NKPromoter class

```typescript
interface NKPromoterConfig {
  /** Librarian intake directory */
  intakeDir: string;
  /** Project name (from .eba.json or fallback to dir name) */
  projectName: string;
  /** Project root path (for stripping paths during generalization) */
  projectRoot: string;
  /** Score threshold for promotion (default: 50) */
  threshold?: number;
}

class NKPromoter {
  constructor(config: NKPromoterConfig);

  /** Evaluate entries and promote qualifying ones. Returns count promoted. */
  promote(entries: NegativeKnowledgeEntry[]): number;

  /** Score a single entry for generalizability (0-100). Exported for testing. */
  score(entry: NegativeKnowledgeEntry): number;

  /** Generalize an entry by stripping project-specific details. Exported for testing. */
  generalize(entry: NegativeKnowledgeEntry): NegativeKnowledgeEntry;
}
```

### Integration with pipeline

In `eba-pipeline.ts`, after the existing NK save block (post-task, when
`failedLogs.length > 0` and the task succeeded):

```typescript
// Promote qualifying NK entries to global store via librarian intake
if (this.config.projectNkStore && this.config.nkPromoter) {
  const newEntries = failedLogs.map(log => /* the entries just added */);
  const promoted = this.config.nkPromoter.promote(newEntries);
  if (promoted > 0) {
    console.log(`📤 Promoted ${promoted} NK entr${promoted === 1 ? 'y' : 'ies'} to global knowledge`);
  }
}
```

The promoter is only created when targeting an external project (in `run.ts`).
When EBA targets itself, NK entries go directly to the global store — no
promotion needed.

### Zero-config operation

NKPromoter is created automatically in `run.ts` when all conditions are met:
1. Targeting an external project (`isExternalProject === true`)
2. Librarian intake directory exists (`D:\_system\librarian\intake\`)

If the librarian intake directory doesn't exist, promotion is silently
skipped — no error, no warning. The feature is invisible until the system
infrastructure is in place.

## Files Changed

| File | Change |
|------|--------|
| `src/pipeline/nk-promoter.ts` | New file. `NKPromoter` class with `score()`, `generalize()`, `promote()`. |
| `src/pipeline/eba-pipeline.ts` | Add `nkPromoter?: NKPromoter` to config. Call `promote()` after NK save when conditions met. |
| `src/run.ts` | Create `NKPromoter` when targeting external project and librarian intake exists. Pass to pipeline config. |
| `tests/pipeline/nk-promoter.test.ts` | New file. Unit tests for scoring, generalization, and promotion. |

## Files Unchanged

- `negative-knowledge.ts` — no changes to the NK store itself
- `prompt-enhancer.ts` — reads NK, doesn't write; unaffected
- `context-discovery.ts` — unaffected
- `tool-shed.ts` — unaffected
- Librarian system — reads intake files as-is; no changes needed

## Testing Strategy

- Unit tests for `score()`: high-scoring entries (framework tags, general
  patterns), low-scoring entries (project paths, no solution), edge cases
  (empty tags, mixed signals)
- Unit tests for `generalize()`: path stripping, filename abstraction, stack
  trace removal, provenance tag addition
- Unit tests for `promote()`: writes correct files to intake dir, skips
  low-scoring entries, handles missing intake dir gracefully
- Integration: pipeline run with failing attempts → successful resolution →
  verify promotion file appears in intake dir

## Scope Boundaries

**In scope:**
- Generalizability scoring heuristic
- Path-stripping generalization
- Librarian intake file writing
- Pipeline integration (post-task hook)
- Zero-config: works when infra exists, invisible when it doesn't

**Out of scope:**
- Librarian processing of intake files (already exists)
- Global-to-project NK propagation (reverse direction)
- Human review/approval of promotions (automated only)
- Deduplication against existing global NK entries (librarian handles this)
- ML-based scoring (heuristic is sufficient for v1)
