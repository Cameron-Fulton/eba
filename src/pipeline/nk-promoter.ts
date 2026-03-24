import * as fs from 'fs';
import * as path from 'path';
import { NegativeKnowledgeEntry } from '../phase1/negative-knowledge';

export interface NKPromoterConfig {
  intakeDir: string;
  projectName: string;
  projectRoot: string;
  threshold?: number;
}

export interface GeneralizedEntry {
  scenario: string;
  attempt: string;
  outcome: string;
  solution: string;
  tags: string[];
  crossProjectReason: string;
}

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

export class NKPromoter {
  private config: NKPromoterConfig;

  private static readonly FRAMEWORK_FILES = new Set([
    'page.tsx', 'layout.tsx', 'middleware.ts', 'docker-compose.yml',
    'next.config.js', 'next.config.ts', 'next.config.mjs',
    'tsconfig.json', 'jest.config.ts', 'jest.config.js',
    'vite.config.ts', 'vite.config.js', 'package.json',
    'Dockerfile', 'Makefile',
  ]);

  constructor(config: NKPromoterConfig) {
    this.config = config;
  }

  score(entry: NegativeKnowledgeEntry): number {
    let score = 0;
    const lowerTags = entry.tags.map(t => t.toLowerCase());
    const combinedText = entry.scenario + ' ' + entry.solution;

    // +20 per framework tag match, max 40
    let frameworkMatches = 0;
    for (const tag of lowerTags) {
      if (FRAMEWORK_TAGS.has(tag)) frameworkMatches++;
    }
    score += Math.min(frameworkMatches * 20, 40);

    // +20 if solution has no absolute paths
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
    // Negative lookbehind for '.' avoids matching parts of dotted names like jest.config.ts
    result = result.replace(/(?<!\.)(?<![/\\])\b(?:[a-z][a-zA-Z]+|[A-Z][a-z]+[A-Z]\w*)\.[a-z]{2,4}\b/g, (match) => {
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

  generalize(entry: NegativeKnowledgeEntry): GeneralizedEntry {
    const scenario = this.stripFilenames(this.stripPaths(entry.scenario));
    const attempt = this.stripFilenames(this.stripPaths(entry.attempt));
    const outcome = this.stripStackTraces(this.stripFilenames(this.stripPaths(entry.outcome)));
    const solution = this.stripFilenames(this.stripPaths(entry.solution));

    // Provenance tags
    const date = new Date().toISOString().slice(0, 10);
    const originalTags = entry.tags.filter(t => t !== 'auto-recorded');
    const tags = [
      ...originalTags,
      'promoted',
      'unvalidated',
      'votes:0',
      `source:${this.config.projectName}`,
      `promoted:${date}`,
    ];

    // crossProjectReason: template from highest-scoring framework tag
    const lowerTags = entry.tags.map(t => t.toLowerCase());
    const frameworkTag = lowerTags.find(t => FRAMEWORK_TAGS.has(t));
    const firstClause = scenario.split(/[.!?\n]/)[0]?.trim() || scenario.trim();
    const crossProjectReason = frameworkTag
      ? `Common ${frameworkTag} pattern: ${firstClause}`
      : `Common development pattern: ${firstClause}`;

    return { scenario, attempt, outcome, solution, tags, crossProjectReason };
  }

  toIntakeMarkdown(entry: GeneralizedEntry, projectName: string): string {
    // Stub — implemented in Task 3
    return '';
  }

  promote(entries: NegativeKnowledgeEntry[]): number {
    // Stub — implemented in Task 4
    return 0;
  }
}
