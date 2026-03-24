/**
 * Context Discovery
 * Reads project documentation files (SYSTEM.md, CLAUDE.md, AGENTS.md) and
 * assembles them into a context string for injection into LLM prompts.
 * Supports markdown file references, .eba.json overrides, and fallback scan.
 */

import * as fs from 'fs';
import * as path from 'path';

const MAX_CONTEXT_CHARS = 50_000;
const TRUNCATION_MARKER = '\n\n[Context truncated at 50,000 characters]';
const MAX_FALLBACK_FILES = 10;
const MAX_FILE_SIZE = 20_000;

const FALLBACK_EXCLUDE = [
  'node_modules', 'memory-packets', '.git', 'dist', 'build',
  'CHANGELOG', 'LICENSE', 'package-lock',
];

export interface EbaConfig {
  test_command?: string;
  project_name?: string;
  context?: string[];
  allowed_commands?: string[];
}

export interface ProjectContext {
  content: string;
  sources: string[];
  truncated: boolean;
  ebaConfig?: EbaConfig;
}

export class ContextDiscovery {
  private projectDir: string;
  private systemMdPath: string;

  constructor(projectDir: string, systemMdPath?: string) {
    this.projectDir = projectDir;
    this.systemMdPath = systemMdPath ?? (process.env.EBA_SYSTEM_MD || 'D:/SYSTEM.md');
  }

  discover(): ProjectContext {
    const sources: string[] = [];
    const sections: string[] = [];
    let foundPrimary = false;

    // 1. System-wide config
    if (fs.existsSync(this.systemMdPath)) {
      const content = this.safeRead(this.systemMdPath);
      if (content) {
        sections.push(`## System Rules (${this.systemMdPath})\n${content}`);
        sources.push(this.systemMdPath);
        foundPrimary = true;
      }
    }

    // 2-3. CLAUDE.md and AGENTS.md
    for (const filename of ['CLAUDE.md', 'AGENTS.md']) {
      const filePath = path.join(this.projectDir, filename);
      if (fs.existsSync(filePath)) {
        const content = this.safeRead(filePath);
        if (content) {
          sections.push(`## ${filename}\n${content}`);
          sources.push(filePath);
          foundPrimary = true;

          // 4. Parse file references
          const refs = this.parseFileReferences(content);
          for (const ref of refs) {
            const refPath = path.resolve(this.projectDir, ref);
            if (!this.isWithinProject(refPath)) continue;
            if (fs.existsSync(refPath) && !sources.includes(refPath)) {
              const refContent = this.safeRead(refPath, true);
              if (refContent) {
                sections.push(`## Referenced: ${ref}\n${refContent}`);
                sources.push(refPath);
              }
            }
          }
        }
      }
    }

    // 5. Fallback scan
    if (!foundPrimary) {
      const fallbackFiles = this.fallbackScan();
      for (const filePath of fallbackFiles) {
        if (sources.includes(filePath)) continue;
        const content = this.safeRead(filePath);
        if (content) {
          const rel = path.relative(this.projectDir, filePath);
          sections.push(`## ${rel}\n${content}`);
          sources.push(filePath);
        }
      }
    }

    // 6. .eba.json context overrides
    let ebaConfig: EbaConfig | undefined;
    const ebaConfigPath = path.join(this.projectDir, '.eba.json');
    if (fs.existsSync(ebaConfigPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(ebaConfigPath, 'utf-8'));
        ebaConfig = {
          test_command: config.test_command,
          project_name: config.project_name,
          context: Array.isArray(config.context) ? config.context : undefined,
          allowed_commands: Array.isArray(config.allowed_commands) ? config.allowed_commands : undefined,
        };
        if (Array.isArray(config.context)) {
          for (const ref of config.context) {
            const refPath = path.resolve(this.projectDir, ref);
            if (!this.isWithinProject(refPath)) continue;
            if (fs.existsSync(refPath) && !sources.includes(refPath)) {
              const content = this.safeRead(refPath, true);
              if (content) {
                sections.push(`## .eba.json context: ${ref}\n${content}`);
                sources.push(refPath);
              }
            }
          }
        }
      } catch { /* invalid JSON */ }
    }

    let assembled = sections.join('\n\n');
    let truncated = false;
    if (assembled.length > MAX_CONTEXT_CHARS) {
      assembled = assembled.slice(0, MAX_CONTEXT_CHARS - TRUNCATION_MARKER.length)
        + TRUNCATION_MARKER;
      truncated = true;
    }

    return { content: assembled, sources, truncated, ebaConfig };
  }

  private parseFileReferences(content: string): string[] {
    const refs: string[] = [];
    const linkPattern = /\[[^\]]*\]\(([^)]+\.(?:md|txt|json))\)/g;
    let match: RegExpExecArray | null;
    while ((match = linkPattern.exec(content)) !== null) {
      const ref = match[1];
      if (ref.startsWith('http://') || ref.startsWith('https://') || ref.startsWith('file://')) {
        continue;
      }
      refs.push(ref);
    }
    return [...new Set(refs)];
  }

  private isWithinProject(resolvedPath: string): boolean {
    // Lowercase both paths for case-insensitive comparison on Windows
    const normalized = path.resolve(this.projectDir).toLowerCase();
    const target = resolvedPath.toLowerCase();
    return target.startsWith(normalized + path.sep) || target === normalized;
  }

  private fallbackScan(): string[] {
    const candidates: string[] = [];

    if (fs.existsSync(this.projectDir)) {
      for (const entry of fs.readdirSync(this.projectDir)) {
        if (!entry.endsWith('.md')) continue;
        if (FALLBACK_EXCLUDE.some(ex => entry.includes(ex))) continue;
        const fullPath = path.join(this.projectDir, entry);
        const stat = fs.statSync(fullPath);
        if (stat.isFile() && stat.size <= MAX_FILE_SIZE) {
          candidates.push(fullPath);
        }
      }
    }

    const docsDir = path.join(this.projectDir, 'docs');
    if (fs.existsSync(docsDir)) {
      for (const entry of fs.readdirSync(docsDir)) {
        if (!entry.endsWith('.md')) continue;
        if (FALLBACK_EXCLUDE.some(ex => entry.includes(ex))) continue;
        const fullPath = path.join(docsDir, entry);
        const stat = fs.statSync(fullPath);
        if (stat.isFile() && stat.size <= MAX_FILE_SIZE) {
          candidates.push(fullPath);
        }
      }
    }

    candidates.sort((a, b) => {
      const aIsReadme = path.basename(a).toLowerCase().startsWith('readme') ? 0 : 1;
      const bIsReadme = path.basename(b).toLowerCase().startsWith('readme') ? 0 : 1;
      if (aIsReadme !== bIsReadme) return aIsReadme - bIsReadme;
      return a.localeCompare(b);
    });

    return candidates.slice(0, MAX_FALLBACK_FILES);
  }

  private safeRead(filePath: string, enforceMaxSize = false): string | null {
    try {
      if (enforceMaxSize) {
        const stat = fs.statSync(filePath);
        if (stat.size > MAX_FILE_SIZE) return null;
      }
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      return content.length > 0 ? content : null;
    } catch { return null; }
  }
}
