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

### Cold start safeguard

Automated promotion runs with zero human involvement. To prevent low-quality
knowledge from degrading long-term performance, every promoted entry is tagged
`unvalidated` with `votes: 0`. This creates a trust tier:

- **Unvalidated (votes: 0):** Freshly promoted, never confirmed by another
  project. Included in search results but ranked below validated entries.
- **Validated (votes >= 1):** A future session on a different project hit the
  same pattern and the solution worked. The vote count increments.

Vote incrementing is **out of scope** for this spec — it requires the prompt
enhancer to track which NK entries were injected and whether the task
succeeded, which is a separate feature. This spec only establishes the
`unvalidated` + `votes: 0` tagging so the infrastructure is in place.

### Promotion flow

```
Pipeline succeeds with recorded failures
  → NKPromoter.promote(newEntries)
    → For each entry:
      1. Score generalizability (tag heuristic + path density)
      2. Check dedup: skip if intake already has file for same scenario
      3. If score >= threshold → generalize → tag unvalidated → write to intake
      4. If score < threshold → skip (stays project-only)
```

### Generalizability scoring

Each entry gets a score. Threshold for promotion: **50**. Scores are clamped
to the range 0-100 after summing all signals.

**Positive signals (add points):**
- Tags contain framework/tool names: `jest`, `typescript`, `react`, `node`,
  `webpack`, `prisma`, `docker`, `git`, `eslint`, `api`, `auth`, `oauth`,
  `cors`, `websocket`, `database`, `migration`, `cache` (+20 per match, max 40)
- Solution field contains a general pattern (no absolute paths) (+20)
- Scenario describes a common operation: "test", "build", "deploy", "import",
  "configure", "install", "migrate" (+15)
- Entry has a successful solution (not "No successful solution found") (+15)

**Negative signals (subtract points):**
- Scenario or solution contains absolute paths (`/home/`, `C:\`, `D:\`) (-20)
- Scenario references specific filenames with extensions (e.g.,
  `userController.ts` — a multi-word or camelCase name + extension) (-15)
- No framework/tool tags beyond `auto-recorded` and SOP id (-10)

The "no framework tags" signal replaces the original "auto-recorded only"
check. Pipeline always adds `auto-recorded` + SOP id, so the real question is
whether the entry has any *useful* tags indicating a generalizable pattern.

### Generalization step

Before writing to the global store, the entry is transformed using **regex
heuristics only** (no LLM calls — keeps the feature synchronous and free):

1. **Strip project paths:** Replace absolute paths matching common project
   root patterns (`/home/`, `/Users/`, `C:\Users\`, `D:\projects\`) with
   `<project>/`. Use `projectRoot` config to also strip the exact project path.
2. **Strip specific filenames:** Replace path segments like
   `src/controllers/userController.ts` with the last directory name only
   (e.g., "a file in controllers/"). Regex: match path-like strings
   (containing `/` or `\` with a `.ext` suffix) and reduce to directory context.
3. **Strip stack traces:** Remove lines matching common stack trace patterns
   (`at Object.<anonymous>`, `at Module._compile`, line:col references).
4. **Preserve the pattern:** The scenario, attempt, outcome, and solution
   text survive generalization — only paths, filenames, and traces are stripped.
5. **Add provenance tags:** `promoted`, `unvalidated`, `votes:0`,
   `source:{projectName}`, `promoted:{YYYY-MM-DD}`
6. **Generate crossProjectReason:** Template-based: `"Common {tool/framework}
   pattern: {first clause of generalized scenario}"`. Extract the tool name
   from the highest-scoring framework tag. If no framework tag matched, use
   `"Common development pattern"` as fallback. This is a display hint for
   the librarian intake, not a precise description.

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
Tags: jest, esm, promoted, unvalidated, votes:0, source:my-auth-app, promoted:2026-03-23
```

### Librarian intake format

Promoted entries are written to the librarian intake directory as markdown
files following the existing intake format.

**Intake directory:** Resolved from `LIBRARIAN_INTAKE_DIR` env var, falling
back to `D:\_system\librarian\intake\`. This allows the path to be configured
per-environment without hardcoding.

**Filename format:** `eba-nk-{projectName}-{YYYY-MM-DD}-{first8charsOfEntryId}.md`

This prevents collisions (entry ID is unique) and makes it easy to see which
project and date a promotion came from when scanning the intake folder.

```markdown
---
source: eba-nk-promotion
project: {project_name from .eba.json or directory name}
date: {YYYY-MM-DD}
type: solution
validated: false
votes: 0
---

## {Generalized scenario}

**Why this matters beyond one project:** {One sentence about the general pattern}

### Failed Approach
{Generalized attempt}

### Why It Failed
{Generalized outcome}

### What Works
{Generalized solution}

**Original tags:** {comma-separated original tags}
**Promoted from:** {project name}
```

The librarian picks these up on its regular scan, processes them into
`D:\_system\knowledge\`, and they become available to all projects.

### Deduplication

Before writing an intake file, `promote()` checks whether a file matching the
same project + scenario already exists in the intake directory. The check
is a filename-prefix scan: look for files starting with
`eba-nk-{projectName}-` and read their `## ` header line. If the generalized
scenario matches an existing file (case-insensitive), skip the write.

This prevents the same failure from generating duplicate intake files across
repeated pipeline runs. Cross-project deduplication (two projects discovering
the same pattern) is left to the librarian.

### NKPromoter class

```typescript
interface NKPromoterConfig {
  /** Librarian intake directory. Resolved from LIBRARIAN_INTAKE_DIR env var
   *  or defaults to D:\_system\librarian\intake\ */
  intakeDir: string;
  /** Project name (from .eba.json or fallback to dir name) */
  projectName: string;
  /** Project root path (for stripping paths during generalization) */
  projectRoot: string;
  /** Score threshold for promotion (default: 50) */
  threshold?: number;
}

interface GeneralizedEntry {
  /** Generalized scenario (paths stripped) */
  scenario: string;
  /** Generalized attempt */
  attempt: string;
  /** Generalized outcome */
  outcome: string;
  /** Generalized solution */
  solution: string;
  /** Original tags + provenance tags (promoted, unvalidated, votes:0, etc.) */
  tags: string[];
  /** One-sentence description of why this matters beyond one project */
  crossProjectReason: string;
}

class NKPromoter {
  constructor(config: NKPromoterConfig);

  /** Evaluate entries and promote qualifying ones. Returns count promoted. */
  promote(entries: NegativeKnowledgeEntry[]): number;

  /** Score a single entry for generalizability (0-100, clamped). */
  score(entry: NegativeKnowledgeEntry): number;

  /** Transform an entry into a generalized version for the global store. */
  generalize(entry: NegativeKnowledgeEntry): GeneralizedEntry;

  /** Render a GeneralizedEntry as librarian intake markdown. */
  toIntakeMarkdown(entry: GeneralizedEntry, projectName: string): string;
}
```

### Integration with pipeline

In `eba-pipeline.ts`, after the existing NK save block. The promotion block
runs **only when the task succeeded AND there were failed attempts** — this
ensures promoted entries always have a verified solution.

```typescript
// Promote qualifying NK entries to global store via librarian intake
if (succeeded && failedLogs.length > 0 && this.config.projectNkStore && this.config.nkPromoter) {
  // Collect the entries that were just added (captured from nkTarget.add() return values)
  const promoted = this.config.nkPromoter.promote(newNkEntries);
  if (promoted > 0) {
    console.log(`📤 Promoted ${promoted} NK entr${promoted === 1 ? 'y' : 'ies'} to global knowledge`);
  }
}
```

The `newNkEntries` array is built by collecting return values from the
`nkTarget.add()` calls in the failed-logs loop above:

```typescript
const newNkEntries: NegativeKnowledgeEntry[] = [];
for (const log of failedLogs) {
  const entry = nkTarget.add({
    scenario: activeTask.slice(0, 200),
    attempt:  log.llm_response.slice(0, 300),
    outcome:  log.test_result.output.slice(0, 300),
    solution: succeeded
      ? `Succeeded on attempt ${logs.findIndex(l => l.status === 'success') + 1}`
      : 'No successful solution found in this session',
    tags:     ['auto-recorded', this.config.sopId],
  });
  newNkEntries.push(entry);
}
nkTarget.saveToDisk();
```

The promoter is only created when targeting an external project (in `run.ts`).
When EBA targets itself, NK entries go directly to the global store — no
promotion needed.

### Zero-config operation

NKPromoter is created automatically in `run.ts` when all conditions are met:
1. Targeting an external project (`isExternalProject === true`)
2. Librarian intake directory exists (from `LIBRARIAN_INTAKE_DIR` env var or
   default path `D:\_system\librarian\intake\`)

If the librarian intake directory doesn't exist, promotion is silently
skipped — no error, no warning. The feature is invisible until the system
infrastructure is in place.

## Files Changed

| File | Change |
|------|--------|
| `src/pipeline/nk-promoter.ts` | New file. `NKPromoter` class with `score()`, `generalize()`, `toIntakeMarkdown()`, `promote()`. `GeneralizedEntry` and `NKPromoterConfig` interfaces. |
| `src/pipeline/eba-pipeline.ts` | Add `nkPromoter?: NKPromoter` to config. Collect `newNkEntries` from `add()` returns. Call `promote()` after NK save when `succeeded && failedLogs.length > 0`. |
| `src/run.ts` | Create `NKPromoter` when targeting external project and librarian intake exists. Pass to pipeline config. Resolve intake dir from env var. |
| `tests/pipeline/nk-promoter.test.ts` | New file. Unit tests for scoring, generalization, dedup, intake file writing, and promotion. |

## Files Unchanged

- `negative-knowledge.ts` — no changes to the NK store itself
- `prompt-enhancer.ts` — reads NK, doesn't write; unaffected
- `context-discovery.ts` — unaffected
- `tool-shed.ts` — unaffected
- Librarian system — reads intake files as-is; no changes needed

## Testing Strategy

- Unit tests for `score()`: high-scoring entries (framework tags, general
  patterns), low-scoring entries (project paths, no solution), edge cases
  (empty tags, mixed signals), verify clamping to 0-100
- Unit tests for `generalize()`: path stripping, filename abstraction, stack
  trace removal, provenance tag addition (`promoted`, `unvalidated`, `votes:0`)
- Unit tests for `toIntakeMarkdown()`: correct frontmatter with
  `validated: false` and `votes: 0`, correct section structure
- Unit tests for `promote()`: writes correct files to intake dir, skips
  low-scoring entries, handles missing intake dir gracefully, deduplicates
  against existing intake files
- Integration: pipeline run with failing attempts → successful resolution →
  verify promotion file appears in intake dir with correct tags

## Scope Boundaries

**In scope:**
- Generalizability scoring heuristic (regex-based, no LLM)
- Path-stripping generalization (regex-based)
- Cold start tagging (`unvalidated`, `votes: 0`)
- Deduplication within intake directory
- Librarian intake file writing
- Pipeline integration (post-task, success-only hook)
- Zero-config: works when infra exists, invisible when it doesn't
- Configurable intake dir via env var

**Out of scope:**
- Vote incrementing on successful cross-project application (future feature)
- Librarian processing of intake files (already exists)
- Global-to-project NK propagation (reverse direction)
- Human review/approval of promotions (automated only)
- Cross-project deduplication (librarian handles this)
- ML-based scoring (heuristic is sufficient for v1)
- LLM-assisted generalization (regex is sufficient for v1)
