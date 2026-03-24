# NK Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically promote generalizable NK entries from project-specific stores to the global knowledge base via the librarian intake, with cold start safeguards and deduplication.

**Architecture:** New `NKPromoter` class with `score()` (heuristic scoring), `generalize()` (regex path-stripping), and `promote()` (dedup + intake file writing). Wired into `eba-pipeline.ts` post-task hook (success-only gate) and created in `run.ts` when targeting external projects.

**Tech Stack:** TypeScript, Jest 29, Node fs/path, regex heuristics

**Spec:** `docs/superpowers/specs/2026-03-23-nk-promotion-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/pipeline/nk-promoter.ts` | Create | `NKPromoterConfig`, `GeneralizedEntry` interfaces. `NKPromoter` class with `score()`, `generalize()`, `toIntakeMarkdown()`, `promote()`. |
| `src/pipeline/eba-pipeline.ts` | Modify | Add `nkPromoter?` to config. Collect `newNkEntries` from `add()` returns. Call `promote()` after NK save on success. |
| `src/run.ts` | Modify | Create `NKPromoter` when external project + intake dir exists. Pass to pipeline. |
| `tests/pipeline/nk-promoter.test.ts` | Create | Unit tests for all public methods. |

---

### Task 1: Scoring — `score()` method

**Files:**
- Create: `src/pipeline/nk-promoter.ts`
- Create: `tests/pipeline/nk-promoter.test.ts`

- [ ] **Step 1: Write failing tests for score()**

```typescript
import { NKPromoter, NKPromoterConfig } from '../../src/pipeline/nk-promoter';
import { NegativeKnowledgeEntry } from '../../src/phase1/negative-knowledge';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function makeEntry(overrides: Partial<NegativeKnowledgeEntry> = {}): NegativeKnowledgeEntry {
  return {
    id: 'nk_test_001',
    scenario: 'Test scenario',
    attempt: 'Test attempt',
    outcome: 'Test outcome',
    solution: 'Test solution',
    tags: ['auto-recorded', 'refactoring'],
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makePromoter(overrides: Partial<NKPromoterConfig> = {}): NKPromoter {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nk-promoter-'));
  return new NKPromoter({
    intakeDir: tempDir,
    projectName: 'test-project',
    projectRoot: '/home/user/projects/test-project',
    ...overrides,
  });
}

describe('NKPromoter', () => {
  describe('score()', () => {
    test('high score for entry with framework tags and clean solution', () => {
      const promoter = makePromoter();
      const entry = makeEntry({
        tags: ['jest', 'typescript', 'auto-recorded', 'refactoring'],
        scenario: 'Jest test fails when importing ESM module',
        solution: 'Add transformIgnorePatterns to jest.config',
      });
      const score = promoter.score(entry);
      expect(score).toBeGreaterThanOrEqual(50);
    });

    test('low score for entry with project-specific paths', () => {
      const promoter = makePromoter();
      const entry = makeEntry({
        tags: ['auto-recorded', 'refactoring'],
        scenario: 'Error in D:\\projects\\myapp\\src\\controllers\\userController.ts',
        solution: 'Fixed the userController.ts file at line 42',
      });
      const score = promoter.score(entry);
      expect(score).toBeLessThan(50);
    });

    test('awards points for framework config file references', () => {
      const promoter = makePromoter();
      const entry = makeEntry({
        tags: ['auto-recorded', 'refactoring'],
        scenario: 'Build fails after editing tsconfig.json',
        solution: 'Set moduleResolution to bundler in tsconfig.json',
      });
      const scoreWith = promoter.score(entry);
      const entryWithout = makeEntry({
        tags: ['auto-recorded', 'refactoring'],
        scenario: 'Build fails after editing config',
        solution: 'Set moduleResolution to bundler',
      });
      const scoreWithout = promoter.score(entryWithout);
      expect(scoreWith).toBeGreaterThan(scoreWithout);
    });

    test('clamps score to 0-100 range', () => {
      const promoter = makePromoter();
      // Max positive signals
      const highEntry = makeEntry({
        tags: ['jest', 'typescript', 'react', 'auto-recorded'],
        scenario: 'Jest test build fails when importing module',
        solution: 'Add config to jest.config.ts',
      });
      expect(promoter.score(highEntry)).toBeLessThanOrEqual(100);

      // Max negative signals
      const lowEntry = makeEntry({
        tags: ['auto-recorded', 'refactoring'],
        scenario: 'Error in D:\\projects\\myapp\\src\\userController.ts at line 42',
        solution: 'Fixed /home/user/projects/myapp/src/userController.ts',
      });
      expect(promoter.score(lowEntry)).toBeGreaterThanOrEqual(0);
    });

    test('penalizes entries with no framework tags', () => {
      const promoter = makePromoter();
      const entry = makeEntry({
        tags: ['auto-recorded', 'refactoring'],
        scenario: 'Something broke',
        solution: 'Fixed it',
      });
      const score = promoter.score(entry);
      // Should have -10 penalty for no framework tags
      expect(score).toBeLessThan(50);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern nk-promoter`
Expected: FAIL — module not found

- [ ] **Step 3: Implement score() and scaffolding**

Create `src/pipeline/nk-promoter.ts` with:
- `NKPromoterConfig` interface
- `GeneralizedEntry` interface
- `NKPromoter` class with `score()` implemented
- Stub `generalize()`, `toIntakeMarkdown()`, `promote()`

Key constants:
```typescript
const FRAMEWORK_TAGS = new Set([
  'jest', 'typescript', 'react', 'node', 'webpack', 'prisma', 'docker',
  'git', 'eslint', 'api', 'auth', 'oauth', 'cors', 'websocket',
  'database', 'migration', 'cache',
]);

const COMMON_OPERATIONS = ['test', 'build', 'deploy', 'import', 'configure', 'install', 'migrate'];

const CONFIG_FILES = [
  'next.config', 'tsconfig', 'jest.config', 'docker-compose',
  'webpack.config', '.eslintrc', 'vite.config', 'package.json',
];

const ABSOLUTE_PATH_PATTERN = /(?:\/home\/|\/Users\/|[A-Z]:\\)/i;
const SPECIFIC_FILENAME_PATTERN = /(?:[a-z][a-zA-Z]+|[A-Z][a-z]+[A-Z])\.[a-z]{2,4}\b/;
const SOP_TAG_PATTERN = /^(?:refactoring|bug-fix|feature|code-review|dependency-upgrade|deployment|database-migration|documentation|security-audit|performance-optimization|infrastructure-probe)$/;
```

Score logic:
```typescript
score(entry: NegativeKnowledgeEntry): number {
  let score = 0;
  const lowerTags = entry.tags.map(t => t.toLowerCase());

  // +20 per framework tag match, max 40
  let frameworkMatches = 0;
  for (const tag of lowerTags) {
    if (FRAMEWORK_TAGS.has(tag)) frameworkMatches++;
  }
  score += Math.min(frameworkMatches * 20, 40);

  // +20 if solution has no absolute paths
  const combinedText = entry.scenario + ' ' + entry.solution;
  if (!ABSOLUTE_PATH_PATTERN.test(entry.solution)) score += 20;

  // +15 if scenario describes a common operation
  const lowerScenario = entry.scenario.toLowerCase();
  if (COMMON_OPERATIONS.some(op => lowerScenario.includes(op))) score += 15;

  // +15 if references framework config files
  if (CONFIG_FILES.some(cf => combinedText.toLowerCase().includes(cf))) score += 15;

  // -20 if scenario or solution contains absolute paths
  if (ABSOLUTE_PATH_PATTERN.test(combinedText)) score -= 20;

  // -15 if scenario references specific filenames (camelCase/multiWord + extension)
  if (SPECIFIC_FILENAME_PATTERN.test(entry.scenario)) score -= 15;

  // -10 if no framework/tool tags beyond auto-recorded and SOP ids
  const usefulTags = lowerTags.filter(t => t !== 'auto-recorded' && !SOP_TAG_PATTERN.test(t));
  const hasFrameworkTag = usefulTags.some(t => FRAMEWORK_TAGS.has(t));
  if (!hasFrameworkTag) score -= 10;

  return Math.max(0, Math.min(100, score));
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern nk-promoter`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/nk-promoter.ts tests/pipeline/nk-promoter.test.ts
git commit -m "feat: NKPromoter score() — generalizability scoring heuristic"
```

---

### Task 2: Generalization — `generalize()` method

**Files:**
- Modify: `src/pipeline/nk-promoter.ts`
- Modify: `tests/pipeline/nk-promoter.test.ts`

- [ ] **Step 1: Write failing tests**

Add to test file:

```typescript
describe('generalize()', () => {
  test('strips project-specific absolute paths', () => {
    const promoter = makePromoter({ projectRoot: 'D:\\projects\\myapp' });
    const entry = makeEntry({
      scenario: 'Error in D:\\projects\\myapp\\src\\auth\\token.ts',
      solution: 'Fixed D:\\projects\\myapp\\src\\auth\\token.ts',
    });
    const gen = promoter.generalize(entry);
    expect(gen.scenario).not.toContain('D:\\projects\\myapp');
    expect(gen.solution).not.toContain('D:\\projects\\myapp');
  });

  test('strips unix absolute paths', () => {
    const promoter = makePromoter({ projectRoot: '/home/user/myapp' });
    const entry = makeEntry({
      scenario: 'Error in /home/user/myapp/src/auth/token.ts',
    });
    const gen = promoter.generalize(entry);
    expect(gen.scenario).not.toContain('/home/user/myapp');
  });

  test('preserves framework-convention filenames', () => {
    const promoter = makePromoter();
    const entry = makeEntry({
      scenario: 'Error in tsconfig.json when setting moduleResolution',
      solution: 'Edit jest.config.ts to add transform',
    });
    const gen = promoter.generalize(entry);
    expect(gen.scenario).toContain('tsconfig.json');
    expect(gen.solution).toContain('jest.config.ts');
  });

  test('strips camelCase specific filenames but keeps directory context', () => {
    const promoter = makePromoter();
    const entry = makeEntry({
      scenario: 'src/controllers/userController.ts throws error',
    });
    const gen = promoter.generalize(entry);
    expect(gen.scenario).not.toContain('userController.ts');
    expect(gen.scenario).toContain('controllers');
  });

  test('strips standalone camelCase filename without path prefix', () => {
    const promoter = makePromoter();
    const entry = makeEntry({
      scenario: 'userController.ts throws TypeError',
    });
    const gen = promoter.generalize(entry);
    expect(gen.scenario).not.toContain('userController.ts');
    // Should keep context like "a project file"
    expect(gen.scenario).toContain('throws TypeError');
  });

  test('strips stack traces', () => {
    const promoter = makePromoter();
    const entry = makeEntry({
      outcome: 'Error: foo\n    at Object.<anonymous> (/test.js:5:1)\n    at Module._compile',
    });
    const gen = promoter.generalize(entry);
    expect(gen.outcome).toContain('Error: foo');
    expect(gen.outcome).not.toContain('at Object.<anonymous>');
    expect(gen.outcome).not.toContain('Module._compile');
  });

  test('adds provenance tags', () => {
    const promoter = makePromoter({ projectName: 'my-app' });
    const entry = makeEntry({ tags: ['jest', 'auto-recorded'] });
    const gen = promoter.generalize(entry);
    expect(gen.tags).toContain('promoted');
    expect(gen.tags).toContain('unvalidated');
    expect(gen.tags).toContain('votes:0');
    expect(gen.tags.some(t => t.startsWith('source:'))).toBe(true);
    expect(gen.tags.some(t => t.startsWith('promoted:'))).toBe(true);
  });

  test('generates crossProjectReason from framework tag', () => {
    const promoter = makePromoter();
    const entry = makeEntry({
      tags: ['jest', 'auto-recorded'],
      scenario: 'Jest test fails with ESM import error',
    });
    const gen = promoter.generalize(entry);
    expect(gen.crossProjectReason).toContain('jest');
  });

  test('falls back to generic crossProjectReason when no framework tag', () => {
    const promoter = makePromoter();
    const entry = makeEntry({
      tags: ['auto-recorded', 'refactoring'],
      scenario: 'Something broke',
    });
    const gen = promoter.generalize(entry);
    expect(gen.crossProjectReason).toContain('Common development pattern');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern nk-promoter`
Expected: FAIL — generalize() not implemented

- [ ] **Step 3: Implement generalize()**

Key implementation:

```typescript
private static readonly FRAMEWORK_FILES = new Set([
  'page.tsx', 'layout.tsx', 'middleware.ts', 'docker-compose.yml',
  'next.config.js', 'next.config.ts', 'next.config.mjs',
  'tsconfig.json', 'jest.config.ts', 'jest.config.js',
  'vite.config.ts', 'vite.config.js', 'package.json',
  'Dockerfile', 'Makefile',
]);
// Also match .eslintrc.* pattern

private stripPaths(text: string): string {
  let result = text;
  // Strip exact project root (escaped for regex)
  const escaped = this.config.projectRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  result = result.replace(new RegExp(escaped + '[/\\\\][^\\s]*', 'gi'), '<project>/...');
  // Strip common absolute path prefixes
  result = result.replace(/(?:\/home\/\S+|\/Users\/\S+|[A-Z]:\\[^\s]+)/gi, '<project>/...');
  return result;
}

private stripFilenames(text: string): string {
  // Match path/to/specificFile.ext — preserve framework-convention files
  let result = text.replace(/(?:[\w./\\-]+[/\\])([\w-]+\.[\w]{1,4})\b/g, (match, filename) => {
    if (NKPromoter.FRAMEWORK_FILES.has(filename) || /^\.eslintrc/.test(filename)) {
      return match; // preserve
    }
    const parts = match.split(/[/\\]/);
    const dir = parts.length >= 2 ? parts[parts.length - 2] : '';
    return dir ? `a file in ${dir}/` : 'a project file';
  });
  // Also strip standalone camelCase/multiWord filenames (no path prefix)
  // e.g., "userController.ts" but NOT "tsconfig.json"
  result = result.replace(/\b(?:[a-z][a-zA-Z]+|[A-Z][a-z]+[A-Z]\w*)\.[a-z]{2,4}\b/g, (match) => {
    if (NKPromoter.FRAMEWORK_FILES.has(match) || /^\.eslintrc/.test(match)) {
      return match;
    }
    return 'a project file';
  });
  return result;
}

private stripStackTraces(text: string): string {
  return text
    .split('\n')
    .filter(line => !/^\s*at\s+/.test(line))
    .filter(line => !/:\d+:\d+\)?$/.test(line.trim()))
    .join('\n')
    .trim();
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern nk-promoter`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/nk-promoter.ts tests/pipeline/nk-promoter.test.ts
git commit -m "feat: NKPromoter generalize() — regex path-stripping and provenance tagging"
```

---

### Task 3: Intake markdown rendering — `toIntakeMarkdown()`

**Files:**
- Modify: `src/pipeline/nk-promoter.ts`
- Modify: `tests/pipeline/nk-promoter.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe('toIntakeMarkdown()', () => {
  test('produces valid frontmatter with validation fields', () => {
    const promoter = makePromoter({ projectName: 'my-app' });
    const gen: GeneralizedEntry = {
      scenario: 'Jest test fails with ESM error',
      attempt: 'Used jest.mock()',
      outcome: 'ESM breaks mock hoisting',
      solution: 'Add transformIgnorePatterns',
      tags: ['jest', 'promoted', 'unvalidated', 'votes:0'],
      crossProjectReason: 'Common jest pattern: Jest test fails with ESM error',
    };
    const md = promoter.toIntakeMarkdown(gen, 'my-app');
    expect(md).toContain('source: eba-nk-promotion');
    expect(md).toContain('project: my-app');
    expect(md).toContain('type: solution');
    expect(md).toContain('validated: false');
    expect(md).toContain('votes: 0');
  });

  test('includes all sections', () => {
    const promoter = makePromoter();
    const gen: GeneralizedEntry = {
      scenario: 'Test scenario',
      attempt: 'Test attempt',
      outcome: 'Test outcome',
      solution: 'Test solution',
      tags: ['promoted'],
      crossProjectReason: 'Common pattern',
    };
    const md = promoter.toIntakeMarkdown(gen, 'test-project');
    expect(md).toContain('## Test scenario');
    expect(md).toContain('### Failed Approach');
    expect(md).toContain('### Why It Failed');
    expect(md).toContain('### What Works');
    expect(md).toContain('**Why this matters beyond one project:**');
  });
});
```

- [ ] **Step 2: Implement toIntakeMarkdown()**

```typescript
toIntakeMarkdown(entry: GeneralizedEntry, projectName: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return [
    '---',
    'source: eba-nk-promotion',
    `project: ${projectName}`,
    `date: ${date}`,
    'type: solution',
    'validated: false',
    'votes: 0',
    '---',
    '',
    `## ${entry.scenario}`,
    '',
    `**Why this matters beyond one project:** ${entry.crossProjectReason}`,
    '',
    '### Failed Approach',
    entry.attempt,
    '',
    '### Why It Failed',
    entry.outcome,
    '',
    '### What Works',
    entry.solution,
    '',
    `**Original tags:** ${entry.tags.join(', ')}`,
    `**Promoted from:** ${projectName}`,
    '',
  ].join('\n');
}
```

- [ ] **Step 3: Run tests**

Run: `npm test -- --testPathPattern nk-promoter`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/nk-promoter.ts tests/pipeline/nk-promoter.test.ts
git commit -m "feat: NKPromoter toIntakeMarkdown() — librarian intake rendering"
```

---

### Task 4: Promotion with dedup — `promote()` method

**Files:**
- Modify: `src/pipeline/nk-promoter.ts`
- Modify: `tests/pipeline/nk-promoter.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe('promote()', () => {
  let tempIntakeDir: string;
  let tempProjectDir: string;

  beforeEach(() => {
    tempIntakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nk-intake-'));
    tempProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nk-project-'));
    fs.mkdirSync(path.join(tempProjectDir, '.eba'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempIntakeDir, { recursive: true, force: true });
    fs.rmSync(tempProjectDir, { recursive: true, force: true });
  });

  test('writes intake file for high-scoring entry', () => {
    const promoter = new NKPromoter({
      intakeDir: tempIntakeDir,
      projectName: 'test-app',
      projectRoot: tempProjectDir,
    });
    const entry = makeEntry({
      tags: ['jest', 'typescript', 'auto-recorded'],
      scenario: 'Jest test fails with ESM import error',
      solution: 'Add transformIgnorePatterns to jest.config',
    });
    const count = promoter.promote([entry]);
    expect(count).toBe(1);
    const files = fs.readdirSync(tempIntakeDir).filter(f => f.endsWith('.md'));
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('eba-nk-test-app');
    const content = fs.readFileSync(path.join(tempIntakeDir, files[0]), 'utf-8');
    expect(content).toContain('validated: false');
    expect(content).toContain('votes: 0');
  });

  test('skips low-scoring entries', () => {
    const promoter = new NKPromoter({
      intakeDir: tempIntakeDir,
      projectName: 'test-app',
      projectRoot: tempProjectDir,
    });
    const entry = makeEntry({
      tags: ['auto-recorded', 'refactoring'],
      scenario: 'Error in D:\\projects\\myapp\\src\\userController.ts',
      solution: 'Fixed /home/user/projects/myapp/src/userController.ts',
    });
    const count = promoter.promote([entry]);
    expect(count).toBe(0);
    const files = fs.readdirSync(tempIntakeDir).filter(f => f.endsWith('.md'));
    expect(files).toHaveLength(0);
  });

  test('deduplicates using promoted_ids.json ledger', () => {
    const promoter = new NKPromoter({
      intakeDir: tempIntakeDir,
      projectName: 'test-app',
      projectRoot: tempProjectDir,
    });
    const entry = makeEntry({
      id: 'nk_dedup_test',
      tags: ['jest', 'typescript', 'auto-recorded'],
      scenario: 'Jest test fails with ESM import error',
      solution: 'Add transformIgnorePatterns to jest.config',
    });
    // First promote — should succeed
    expect(promoter.promote([entry])).toBe(1);
    // Second promote with same entry — should skip
    expect(promoter.promote([entry])).toBe(0);
    // Ledger should exist
    const ledgerPath = path.join(tempProjectDir, '.eba', 'promoted_ids.json');
    expect(fs.existsSync(ledgerPath)).toBe(true);
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
    expect(ledger).toContain('nk_dedup_test');
  });

  test('promote() writes file and pipeline integration works end-to-end', () => {
    // Integration test: simulate the full pipeline flow
    const promoter = new NKPromoter({
      intakeDir: tempIntakeDir,
      projectName: 'integration-app',
      projectRoot: tempProjectDir,
    });
    // Simulate what eba-pipeline does: collect entries from nkTarget.add()
    const entries = [
      makeEntry({
        id: 'nk_integ_001',
        tags: ['jest', 'typescript', 'auto-recorded', 'refactoring'],
        scenario: 'Jest test fails when importing ESM module',
        solution: 'Add transformIgnorePatterns to jest.config',
      }),
      makeEntry({
        id: 'nk_integ_002',
        tags: ['auto-recorded', 'refactoring'],
        scenario: 'Error in D:\\projects\\myapp\\src\\userController.ts',
        solution: 'Fixed the file at D:\\projects\\myapp\\src\\userController.ts',
      }),
    ];
    const count = promoter.promote(entries);
    // First entry should promote (high score), second should not (low score)
    expect(count).toBe(1);
    const files = fs.readdirSync(tempIntakeDir).filter(f => f.endsWith('.md'));
    expect(files).toHaveLength(1);
    // Verify intake file has cold start tags
    const content = fs.readFileSync(path.join(tempIntakeDir, files[0]), 'utf-8');
    expect(content).toContain('validated: false');
    expect(content).toContain('votes: 0');
    expect(content).toContain('unvalidated');
    // Verify dedup ledger was written
    const ledger = JSON.parse(fs.readFileSync(
      path.join(tempProjectDir, '.eba', 'promoted_ids.json'), 'utf-8'
    ));
    expect(ledger).toContain('nk_integ_001');
    expect(ledger).not.toContain('nk_integ_002');
  });

  test('handles missing intake directory gracefully', () => {
    const promoter = new NKPromoter({
      intakeDir: '/nonexistent/path/intake',
      projectName: 'test-app',
      projectRoot: tempProjectDir,
    });
    const entry = makeEntry({
      tags: ['jest', 'typescript', 'auto-recorded'],
      scenario: 'Jest test fails',
      solution: 'Fix jest config',
    });
    // Should not throw, just return 0
    expect(promoter.promote([entry])).toBe(0);
  });
});
```

- [ ] **Step 2: Implement promote()**

```typescript
promote(entries: NegativeKnowledgeEntry[]): number {
  if (!fs.existsSync(this.config.intakeDir)) return 0;

  const ledgerPath = this.getLedgerPath();
  const promotedIds = this.loadLedger(ledgerPath);
  let count = 0;

  for (const entry of entries) {
    if (promotedIds.has(entry.id)) continue;
    if (this.score(entry) < (this.config.threshold ?? 50)) continue;

    const generalized = this.generalize(entry);
    const markdown = this.toIntakeMarkdown(generalized, this.config.projectName);
    const date = new Date().toISOString().slice(0, 10);
    const filename = `eba-nk-${this.config.projectName}-${date}-${entry.id.slice(0, 8)}.md`;

    try {
      fs.writeFileSync(path.join(this.config.intakeDir, filename), markdown, 'utf-8');
      promotedIds.add(entry.id);
      count++;
    } catch { /* intake dir may have become unavailable */ }
  }

  if (count > 0) {
    this.saveLedger(ledgerPath, promotedIds);
  }
  return count;
}

private getLedgerPath(): string {
  return path.join(this.config.projectRoot, '.eba', 'promoted_ids.json');
}

private loadLedger(ledgerPath: string): Set<string> {
  try {
    const data = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
    return new Set(Array.isArray(data) ? data : []);
  } catch {
    return new Set();
  }
}

private saveLedger(ledgerPath: string, ids: Set<string>): void {
  const dir = path.dirname(ledgerPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ledgerPath, JSON.stringify([...ids], null, 2), 'utf-8');
}
```

- [ ] **Step 3: Run tests**

Run: `npm test -- --testPathPattern nk-promoter`
Expected: All pass

- [ ] **Step 4: Run full suite**

Run: `npm test`
Expected: All 339+ tests pass

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/nk-promoter.ts tests/pipeline/nk-promoter.test.ts
git commit -m "feat: NKPromoter promote() — dedup ledger and intake file writing"
```

---

### Task 5: Pipeline integration — wire into eba-pipeline.ts

**Files:**
- Modify: `src/pipeline/eba-pipeline.ts`

- [ ] **Step 1: Add nkPromoter to EBAPipelineConfig**

At the end of the `EBAPipelineConfig` interface (around line 97), add:
```typescript
/** NK promoter for project-to-global knowledge propagation */
nkPromoter?: NKPromoter;
```

Add the import at the top:
```typescript
import { NKPromoter } from './nk-promoter';
```

Also import `NegativeKnowledgeEntry`:
```typescript
import { NegativeKnowledgeStore, NegativeKnowledgeEntry } from '../phase1/negative-knowledge';
```

- [ ] **Step 2: Modify the NK save block to collect entries**

In the `run()` method, change the NK save block (lines 274-291) from:

```typescript
const failedLogs = logs.filter(l => l.status === 'failure');
const nkTarget = this.config.projectNkStore ?? this.negativeKnowledge;
if (failedLogs.length > 0) {
  for (const log of failedLogs) {
    nkTarget.add({
      // ...
    });
  }
  nkTarget.saveToDisk();
  console.log(`\n💾 Recorded ${failedLogs.length} failure(s) to negative knowledge store`);
}
```

To:

```typescript
const failedLogs = logs.filter(l => l.status === 'failure');
const nkTarget = this.config.projectNkStore ?? this.negativeKnowledge;
const newNkEntries: NegativeKnowledgeEntry[] = [];
if (failedLogs.length > 0) {
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
  console.log(`\n💾 Recorded ${failedLogs.length} failure(s) to negative knowledge store`);
}

// Promote qualifying NK entries to global store via librarian intake
if (succeeded && failedLogs.length > 0 && this.config.projectNkStore && this.config.nkPromoter) {
  try {
    const promoted = this.config.nkPromoter.promote(newNkEntries);
    if (promoted > 0) {
      console.log(`📤 Promoted ${promoted} NK entr${promoted === 1 ? 'y' : 'ies'} to global knowledge`);
    }
  } catch (err) {
    console.warn('NK promotion failed (non-fatal):', err instanceof Error ? err.message : String(err));
  }
}
```

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: All tests pass (existing tests don't provide `nkPromoter`, so behavior unchanged)

- [ ] **Step 4: Run typecheck**

Run: `npm run lint`
Expected: Clean

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/eba-pipeline.ts
git commit -m "feat: wire NKPromoter into EBAPipeline post-task hook"
```

---

### Task 6: Wire run.ts — create NKPromoter for external projects

**Files:**
- Modify: `src/run.ts`

- [ ] **Step 1: Add import**

```typescript
import { NKPromoter } from './pipeline/nk-promoter';
```

- [ ] **Step 2: Create NKPromoter after the isExternalProject block**

After the `.eba/` directory setup and dual NK store setup, add:

```typescript
// Create NK promoter for external projects (when librarian intake exists)
let nkPromoter: NKPromoter | undefined;
if (isExternalProject) {
  const intakeDir = process.env.LIBRARIAN_INTAKE_DIR ?? 'D:\\_system\\librarian\\intake';
  if (fs.existsSync(intakeDir)) {
    nkPromoter = new NKPromoter({
      intakeDir,
      projectName: ebaConfig?.project_name ?? path.basename(targetProjectDir),
      projectRoot: targetProjectDir,
    });
    console.log('📤 NK promotion enabled (librarian intake available)');
  }
}
```

- [ ] **Step 3: Pass nkPromoter to pipeline**

In the `EBAPipeline` constructor call, add `nkPromoter,` to the config object.

- [ ] **Step 4: Run all tests + typecheck**

Run: `npm test && npm run lint`
Expected: All pass, clean

- [ ] **Step 5: Commit**

```bash
git add src/run.ts
git commit -m "feat: create NKPromoter in run.ts for external project targets"
```

---

### Task 7: Final smoke test

- [ ] **Step 1: Run full suite**

Run: `npm test`
Expected: 350+ tests, all pass

- [ ] **Step 2: Typecheck**

Run: `npm run lint`
Expected: Clean

- [ ] **Step 3: Verify no regressions**

---

## Dependency Graph

```
Task 1 (score) → Task 2 (generalize) → Task 3 (toIntakeMarkdown) → Task 4 (promote)
                                                                         ↓
                                                          Task 5 (pipeline) → Task 6 (run.ts) → Task 7 (smoke)
```

All tasks are sequential — each builds on the previous. No parallelism possible since they all touch the same two files.
