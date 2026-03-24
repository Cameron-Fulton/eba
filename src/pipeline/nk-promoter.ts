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

  generalize(entry: NegativeKnowledgeEntry): GeneralizedEntry {
    // Stub — implemented in Task 2
    return {
      scenario: entry.scenario,
      attempt: entry.attempt,
      outcome: entry.outcome,
      solution: entry.solution,
      tags: [...entry.tags],
      crossProjectReason: '',
    };
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
