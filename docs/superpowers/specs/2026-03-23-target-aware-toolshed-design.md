# Target-Aware Tool-Shed

**Date:** 2026-03-23
**Status:** Approved

## Problem

EBA can discover context from external projects and run their tests, but cannot
read or write files in them. The tool-shed is hardcoded to EBA's own project
root. Post-task artifacts (NK entries, memory packets, logs) always write to
EBA's own directories regardless of which project the task targets.

## Solution

Make the tool-shed and artifact paths target-aware. When EBA works on an
external project, file operations scope to that project and session artifacts
write to that project's `.eba/` directory.

### Tool-shed scoping

`run.ts` passes `targetProjectDir` to `createDefaultToolShed()` instead of
`ROOT_DIR` when an external project is targeted. The `ToolShed` constructor
changes from positional args to a config object (`ToolShedConfig`) to accept
`allowedPrefixes`, `testCommand`, and `approvalHandler` alongside `projectRoot`.

All path validation (file read/write/edit) is already relative to `projectRoot`.
The `grep_search` and `glob_find` tools currently bypass this validation —
they use `cwd ?? process.cwd()` as their base instead of `this.projectRoot`.
This must be fixed: both tools must default to `this.projectRoot` and validate
any explicit path parameter against `isWithinProjectRoot()`.

When no target is specified (orchestrator/fallback modes), `projectRoot`
stays as `ROOT_DIR` — EBA working on itself.

### Command allowlist per project

Default allowlist: `npm`, `npx`, `jest`, `git`, `node`, `ts-node`, `tsc`.

`.eba.json` gains an optional `allowed_commands` field:

```json
{
  "test_command": "pytest",
  "project_name": "my-python-app",
  "allowed_commands": ["python", "pytest", "pip", "make"]
}
```

When `allowed_commands` is present, it **replaces** the defaults — except
`git`, which is always allowed (the LLM needs it to inspect diffs, check
status, etc. regardless of project language). So the effective allowlist
is `["git", ...allowed_commands]`.

A hardcoded blocklist always applies regardless of `.eba.json`. The blocklist
uses **word-boundary matching** on each segment of a compound command:

1. Split the command string on shell operators: `&&`, `||`, `;`, `|`
2. For each segment, trim whitespace and extract the first token (the command name)
3. Check that token against the blocklist using exact match

Blocklisted commands: `rm`, `rmdir`, `del`, `format`, `shutdown`, `reboot`,
`mkfs`, `dd`, `killall`, `pkill`.

A command must pass both gates: its first token must be in the allowlist,
AND no segment's first token may be in the blocklist.

Example: `npm run build && rm -rf /`
- Segment 1: `npm run build` → first token `npm` → passes allowlist
- Segment 2: `rm -rf /` → first token `rm` → **blocked by blocklist**
- Result: rejected

**Threat model note:** This blocklist guards against accidental LLM-generated
destructive commands, not adversarial input. Subshell expansion (`$(...)`,
backticks) and process substitution are not parsed. A full shell parser would
be needed for adversarial defense, which is out of scope — EBA is invoked by
trusted users and the LLM is the only command generator.

### Post-task artifacts go to target project

When `targetProjectDir` differs from `ROOT_DIR`, artifacts write to
`.eba/` in the target project root:

| Artifact | Path |
|----------|------|
| NK entries | `{target}/.eba/solutions/` |
| Memory packets | `{target}/.eba/memory-packets/` |
| Execution logs | `{target}/.eba/logs/` |

When targeting itself (no external project), paths stay as they are today
(`docs/solutions/`, `docs/memory-packets/`, `docs/logs/`). This asymmetry
is intentional — migrating EBA's own artifact layout is out of scope.

On first write to `.eba/`, EBA:
1. Creates the directory structure
2. Logs: `Creating .eba/ in {project} for EBA artifacts`
3. If `.git/` exists in the target project, creates `.eba/.gitignore`:

```
# EBA session artifacts
logs/
memory-packets/
# Solutions are committed — curated project-specific knowledge
```

Solutions are not gitignored. They are curated knowledge specific to the
project and worth keeping in version control.

### NK loading — separate stores, project-first search

EBA uses **two separate NK store instances**, not a merged store:

1. **Global store** — `NegativeKnowledgeStore(ROOT_DIR + '/docs/solutions/')`
2. **Project store** — `NegativeKnowledgeStore(target + '/.eba/solutions/')`

Each store loads and saves independently. `saveToDisk()` on the project
store writes only project entries to the project directory. Global entries
never leak into the project store and vice versa.

New NK entries from the current session are written to the **project store**
when targeting an external project, or to the **global store** when EBA
targets itself.

The prompt enhancer receives both stores and uses a **project-first** search:
1. Search project store first (keyword match, up to 5 results)
2. Fill remaining slots (up to 5 total) from global store
3. Project-specific failures always take priority

### test_runner tool delegates to configured test command

The tool-shed's `test_runner` case currently hardcodes `npx jest`. It must
instead use the configured test command passed via `ToolShedConfig.testCommand`.

Resolution priority:
1. `.eba.json` `test_command` (if present)
2. `TEST_COMMAND` env var
3. `npm test` (default)

When a custom `testCommand` is configured, the `filter` parameter is
**ignored** — the command runs as-is. Filter-based test selection only works
with the default Jest runner. This is a known limitation documented here.

### Zero-config operation

EBA works on a target project with no `.eba.json` required:
- `projectRoot` = cwd
- `test_command` = `npm test`
- `allowed_commands` = default Node allowlist
- Artifacts write to `{target}/.eba/`

`.eba.json` is purely for customization. The first time EBA runs against
a project, it just works.

## Files Changed

| File | Change |
|------|--------|
| `src/run.ts` | Pass `targetProjectDir` to `createDefaultToolShed()`. Redirect `solutionsDir`, `packetsDir`, `logsDir` to `.eba/` when targeting external project. Create `.eba/` + `.gitignore` on first write. Remove redundant `.eba.json` reading — use `projectContext.ebaConfig` instead. |
| `src/phase2/tool-shed.ts` | Refactor constructor to accept `ToolShedConfig`. Add `allowedPrefixes` and `testCommand` config. Add blocklist with segment-based matching. Fix `grep_search`/`glob_find` to use `projectRoot` and validate paths. Update `test_runner` to use configured command. |
| `src/pipeline/eba-pipeline.ts` | Accept separate global and project NK stores. Pass both to prompt enhancer. Save new NK entries to the correct store based on target. |
| `src/pipeline/prompt-enhancer.ts` | Accept two NK stores. Project-first search (project entries fill first, global fills remaining slots). |
| `src/pipeline/context-discovery.ts` | Return parsed `EbaConfig` from `.eba.json` in `ProjectContext.ebaConfig`. |
| `tests/phase2/tool-shed.test.ts` | Update constructor calls to use config object. Add blocklist tests, allowlist replacement tests, search tool path validation tests. |
| `tests/pipeline/eba-pipeline.test.ts` | Update for dual NK store interface. |
| `tests/pipeline/prompt-enhancer.test.ts` | Test project-first NK search. |
| `tests/pipeline/context-discovery.test.ts` | Test `ebaConfig` field returned from `.eba.json`. |

## Files Unchanged

- `ToolShed` core: `validatePath()`, `isWithinProjectRoot()`, `execute()` switch structure
- Task intake system — untouched
- Compression agent, SOP engine, consortium voter — untouched
- `/eba` skill — already passes cwd as target project

## Interfaces

### createDefaultToolShed (updated signature)

```typescript
function createDefaultToolShed(config: ToolShedConfig): ToolShed
```

Replaces `createDefaultToolShed(projectRoot?: string)`. All existing call
sites (run.ts, tests) update to pass a config object.

### ToolShedConfig (new — replaces positional constructor args)

```typescript
interface ToolShedConfig {
  projectRoot: string;
  /** Command prefixes allowed for bash_execute. Replaces defaults when provided.
   *  `git` is always included regardless of this setting. */
  allowedPrefixes?: string[];
  /** Test command for the test_runner tool. Default: 'npm test' */
  testCommand?: string;
  /** External path approval handler */
  approvalHandler?: ExternalPathApprovalHandler;
}
```

### .eba.json schema (updated)

```typescript
interface EbaConfig {
  test_command?: string;
  project_name?: string;
  context?: string[];
  /** Command prefixes allowed for bash_execute. Replaces Node defaults.
   *  `git` is always included regardless of this setting. */
  allowed_commands?: string[];
}
```

### ProjectContext (updated)

```typescript
interface ProjectContext {
  content: string;
  sources: string[];
  truncated: boolean;
  /** Parsed .eba.json config, or undefined if no .eba.json found */
  ebaConfig?: EbaConfig;
}
```

### EBAPipelineConfig (updated)

```typescript
interface EBAPipelineConfig {
  // ... existing fields ...
  /** Project-specific NK store. When targeting external projects, writes here. */
  projectNkStore?: NegativeKnowledgeStore;
}
```

### PromptEnhancerConfig (updated)

```typescript
interface PromptEnhancerConfig {
  // ... existing fields ...
  /** Project-specific NK store for project-first search */
  projectNegativeKnowledge?: NegativeKnowledgeStore;
}
```

## Safety Model

- **File read/write/edit**: bounded by `projectRoot` via `isWithinProjectRoot()`
- **File search (grep/glob)**: bounded by `projectRoot` — defaults to `projectRoot`, explicit paths validated
- **Bash commands**: bounded by allowlist AND segment-level blocklist
- **External path access**: still requires 3PM approval gate
- **No write access to EBA home during execution**: NK/packet/log writes use dedicated pipeline paths
- **Blocklist is immutable**: cannot be overridden by `.eba.json` or env vars
- **`git` always allowed**: cannot be removed from allowlist even via override

## Testing Strategy

- Unit tests for `ToolShed`: blocklist rejects chained dangerous commands,
  allowlist replacement from config, `git` survives replacement,
  test_runner uses configured command, grep_search/glob_find bounded by projectRoot
- Unit tests for dual NK: separate stores load/save independently,
  project-first search prioritizes project entries, global fills gaps
- Unit tests for `ContextDiscovery`: returns `ebaConfig` from `.eba.json`
- Integration test: full flow with target project dir, verify artifacts land
  in `.eba/`, verify `.gitignore` created only when `.git/` exists
- Existing tests updated for `ToolShedConfig` constructor change

## Scope Boundaries

**In scope:**
- Tool-shed `projectRoot` targeting via config object
- Command allowlist per project with segment-level blocklist
- Search tool (`grep_search`, `glob_find`) path validation
- Artifact directory redirection to `.eba/`
- Dual NK stores with project-first search
- test_runner delegation to configured command

**Out of scope (future work):**
- Migrating EBA's own artifacts from `docs/` to `.eba/`
- NK promotion from project-specific to global (librarian integration)
- Multi-agent mode target awareness (currently only works on ROOT_DIR)
- Multi-project sessions (working on two projects simultaneously)
- Remote project targeting (SSH, containers)
- test_runner filter parameter for non-Jest test frameworks
- Monorepo-aware `.eba/` placement (currently always at `targetProjectDir` root)
- Adversarial command injection defense (subshell, backtick, process substitution)
