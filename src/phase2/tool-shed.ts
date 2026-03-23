/**
 * Phase 2: Tool Shed (Meta-Agentics)
 * Centralized tool registry with schema definitions.
 * Lightweight Tool Selector picks only the 2-3 relevant tools per task.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync, execSync } from 'child_process';

function walkDir(dir: string, extensions?: string[]): string[] {
  const results: string[] = [];
  const exts = extensions ?? ['.ts', '.js', '.json', '.md'];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      results.push(...walkDir(fullPath, exts));
    } else if (entry.isFile()) {
      if (exts.length === 0 || exts.some(ext => entry.name.endsWith(ext))) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

export interface ToolSchema {
  name: string;
  description: string;
  category: 'read' | 'write' | 'execute' | 'search' | 'analyze';
  parameters: ToolParameter[];
  risk_level: 'low' | 'medium' | 'high' | 'critical';
}

export interface ToolParameter {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface ToolExecutionResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface ExternalPathApprovalRequest {
  action: 'bash_execute';
  risk_level: 'critical';
  external_path: string;
  project_root: string;
  command: string;
  prompt: string;
  timestamp: string;
}

export type ExternalPathApprovalHandler = (request: ExternalPathApprovalRequest) => boolean;

function promptApproval(message: string): boolean {
  process.stdout.write(message);

  const inputBuffer = Buffer.alloc(1024);
  let input = '';

  while (!input.includes('\n')) {
    const bytesRead = fs.readSync(process.stdin.fd, inputBuffer, 0, inputBuffer.length, null);
    if (bytesRead <= 0) break;
    input += inputBuffer.toString('utf-8', 0, bytesRead);
  }

  const normalized = input.trim().toLowerCase();
  return normalized === 'y' || normalized === 'yes';
}

export interface ToolShedConfig {
  projectRoot: string;
  allowedPrefixes?: string[];
  testCommand?: string;
  approvalHandler?: ExternalPathApprovalHandler;
}

const DEFAULT_ALLOWED_PREFIXES = ['npm ', 'npx ', 'jest ', 'git ', 'node ', 'ts-node ', 'tsc '];

export class ToolShed {
  private tools: Map<string, ToolSchema> = new Map();
  private projectRoot: string;
  private allowedPrefixes: string[];
  private testCommand: string;
  private externalPathApprovalHandler: ExternalPathApprovalHandler;

  constructor(config: ToolShedConfig) {
    this.projectRoot = path.resolve(config.projectRoot);
    this.allowedPrefixes = config.allowedPrefixes
      ? ['git ', ...config.allowedPrefixes.filter(p => p !== 'git ').map(p => p.endsWith(' ') ? p : p + ' ')]
      : DEFAULT_ALLOWED_PREFIXES;
    this.testCommand = config.testCommand ?? 'npm test';
    this.externalPathApprovalHandler = config.approvalHandler ?? (request => promptApproval(request.prompt));
  }

  private validatePath(filePath: string): string {
    if (typeof filePath !== 'string' || filePath.trim() === '') {
      throw new Error('Invalid path: path must be a non-empty string');
    }

    const resolvedPath = path.resolve(this.projectRoot, filePath);
    if (!this.isWithinProjectRoot(resolvedPath)) {
      throw new Error(`Path escapes project root: ${filePath}`);
    }

    return resolvedPath;
  }

  private isWithinProjectRoot(candidatePath: string): boolean {
    const normalizedRoot = path.resolve(this.projectRoot);
    const normalizedCandidate = path.resolve(candidatePath);
    return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(normalizedRoot + path.sep);
  }

  private extractPathCandidates(command: string): string[] {
    const tokens = command.match(/(?:"[^"]*"|'[^']*'|\S+)/g) ?? [];
    const candidates: string[] = [];

    for (const token of tokens) {
      const unquoted = token.replace(/^['"]|['"]$/g, '');
      const value = unquoted.includes('=') ? unquoted.split('=').pop() ?? '' : unquoted;
      if (!value) continue;

      const looksLikePath =
        value.startsWith('/') ||
        /^[A-Za-z]:[\\/]/.test(value) ||
        value.startsWith('./') ||
        value.startsWith('../');

      if (looksLikePath) {
        candidates.push(value);
      }
    }

    return [...new Set(candidates)];
  }

  private resolveCandidatePath(candidate: string, baseCwd: string): string {
    const isAbsolute = candidate.startsWith('/') || /^[A-Za-z]:[\\/]/.test(candidate);
    if (isAbsolute) {
      return path.resolve(candidate);
    }

    return path.resolve(baseCwd, candidate);
  }

  private buildExternalPathPermissionDeniedError(externalPath: string): Error {
    return new Error(
      `Permission Denied: bash_execute attempted to access external path '${externalPath}' which is outside the project root '${this.projectRoot}'. To allow this, a human must explicitly approve external path access via 3PM gating.`,
    );
  }

  private approveExternalPathAccess(command: string, externalPath: string): boolean {
    const prompt = `[3PM GATE] bash_execute wants to access external path: ${externalPath}\nProject root: ${this.projectRoot}\nCommand: ${command}\nApprove external access? (y/N): `;

    const request: ExternalPathApprovalRequest = {
      action: 'bash_execute',
      risk_level: 'critical',
      external_path: externalPath,
      project_root: this.projectRoot,
      command,
      prompt,
      timestamp: new Date().toISOString(),
    };

    return this.externalPathApprovalHandler(request);
  }

  setExternalPathApprovalHandler(handler: ExternalPathApprovalHandler): void {
    this.externalPathApprovalHandler = handler;
  }

  register(tool: ToolSchema): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): ToolSchema | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolSchema[] {
    return Array.from(this.tools.values());
  }

  getByCategory(category: ToolSchema['category']): ToolSchema[] {
    return this.getAll().filter(t => t.category === category);
  }

  getByRiskLevel(level: ToolSchema['risk_level']): ToolSchema[] {
    return this.getAll().filter(t => t.risk_level === level);
  }

  /**
   * Selects the most relevant tools for a task description.
   * Returns at most `maxTools` tools ranked by keyword relevance.
   */
  selectTools(taskDescription: string, maxTools: number = 3): ToolSchema[] {
    const words = taskDescription.toLowerCase().split(/\s+/);

    const scored = this.getAll().map(tool => {
      let score = 0;
      const toolText = `${tool.name} ${tool.description} ${tool.category}`.toLowerCase();

      for (const word of words) {
        if (word.length < 3) continue;
        if (toolText.includes(word)) {
          score += 1;
        }
      }

      // Boost based on task-category heuristics
      if (words.some(w => ['read', 'find', 'search', 'look', 'check'].includes(w))) {
        if (tool.category === 'read' || tool.category === 'search') score += 2;
      }
      if (words.some(w => ['write', 'create', 'modify', 'edit', 'update', 'add'].includes(w))) {
        if (tool.category === 'write') score += 2;
      }
      if (words.some(w => ['run', 'execute', 'test', 'build', 'deploy'].includes(w))) {
        if (tool.category === 'execute') score += 2;
      }
      if (words.some(w => ['analyze', 'review', 'inspect', 'compare'].includes(w))) {
        if (tool.category === 'analyze') score += 2;
      }

      return { tool, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxTools)
      .map(s => s.tool);
  }

  execute(toolName: string, params: Record<string, unknown>, cwd?: string): ToolExecutionResult {
    try {
      switch (toolName) {
        case 'file_read': {
          const filePath = this.validatePath(params['path'] as string);
          const content = fs.readFileSync(filePath, 'utf-8');
          return { success: true, output: content };
        }
        case 'file_write': {
          const filePath = this.validatePath(params['path'] as string);
          const content = params['content'] as string;
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(filePath, content, 'utf-8');
          return { success: true, output: `Written to ${filePath}` };
        }
        case 'file_edit': {
          const filePath = this.validatePath(params['path'] as string);
          const oldText = params['old_text'] as string;
          const newText = params['new_text'] as string;
          const existing = fs.readFileSync(filePath, 'utf-8');
          if (!existing.includes(oldText)) {
            return { success: false, output: '', error: `old_text not found in ${filePath}` };
          }
          fs.writeFileSync(filePath, existing.replace(oldText, newText), 'utf-8');
          return { success: true, output: `Edited ${filePath}` };
        }
        case 'bash_execute': {
          const command = params['command'] as string;
          const trimmedCommand = command.trim();
          const isAllowed = this.allowedPrefixes.some(prefix => trimmedCommand.startsWith(prefix));

          if (!isAllowed) {
            return {
              success: false,
              output: '',
              error: `Command not allowed. Allowed prefixes: ${this.allowedPrefixes.join(', ')}`,
            };
          }

          const effectiveCwd = path.resolve(cwd ?? this.projectRoot);
          const pathCandidates = this.extractPathCandidates(command);
          for (const candidate of pathCandidates) {
            const resolvedCandidatePath = this.resolveCandidatePath(candidate, effectiveCwd);
            if (!this.isWithinProjectRoot(resolvedCandidatePath)) {
              const approved = this.approveExternalPathAccess(command, resolvedCandidatePath);
              if (!approved) {
                throw this.buildExternalPathPermissionDeniedError(resolvedCandidatePath);
              }
            }
          }

          if (process.platform === 'win32') {
            // eslint-disable-next-line no-console
            console.warn(
              '[ToolShed] bash_execute: bash may not be available on Windows. Consider using PowerShell or WSL.',
            );
          }
          const output = execSync(command, { cwd, encoding: 'utf-8', timeout: 30000 });
          return { success: true, output };
        }
        case 'test_runner': {
          const filter = params['filter'] as string | undefined;
          const args = ['jest', '--runInBand', '--forceExit'];
          if (filter) {
            args.push('--testNamePattern', filter);
          }

          const out = execFileSync('npx', args, {
            cwd: cwd ?? process.cwd(),
            encoding: 'utf-8',
            timeout: 120000,
          });
          return { success: true, output: out };
        }
        case 'grep_search': {
          const pattern = params['pattern'] as string;
          const baseCwd = cwd ?? process.cwd();
          const requestedPath = (params['path'] as string | undefined) ?? '.';
          const searchRoot = path.isAbsolute(requestedPath) ? requestedPath : path.resolve(baseCwd, requestedPath);
          const extensions = (params['extensions'] as string[] | undefined) ?? ['.ts', '.js', '.json', '.md'];

          const files = walkDir(searchRoot, extensions);
          const matches: string[] = [];
          let regex: RegExp | null = null;
          try {
            regex = new RegExp(pattern);
          } catch {
            regex = null;
          }

          for (const file of files) {
            let content: string;
            try {
              content = fs.readFileSync(file, 'utf-8');
            } catch {
              continue;
            }

            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              const isMatch = regex ? regex.test(line) : line.includes(pattern);
              if (isMatch) {
                const displayPath = path.relative(baseCwd, file) || file;
                matches.push(`${displayPath}:${i + 1}:${line}`);
              }
            }
          }

          return { success: true, output: matches.length > 0 ? matches.join('\n') : '(no matches)' };
        }
        case 'glob_find': {
          const pattern = params['pattern'] as string;
          const baseCwd = cwd ?? process.cwd();
          const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
          const globRegex = new RegExp(`^${escaped}$`);
          const files = walkDir(baseCwd, []);

          const matches = files
            .filter(filePath => globRegex.test(path.basename(filePath)))
            .map(filePath => path.relative(baseCwd, filePath) || filePath);

          return { success: true, output: matches.length > 0 ? matches.join('\n') : '(no matches)' };
        }
        case 'code_analyzer': {
          const analyzePath = params['path'] as string;
          return { success: true, output: `Analysis target: ${analyzePath}` };
        }
        default:
          return { success: false, output: '', error: `Unknown tool: ${toolName}` };
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error };
    }
  }
}

/** Default tools that model a typical AI engineering environment */
export function createDefaultToolShed(config?: ToolShedConfig): ToolShed {
  const shed = new ToolShed(config ?? { projectRoot: process.cwd() });

  shed.register({
    name: 'file_read',
    description: 'Read contents of a file from the filesystem',
    category: 'read',
    parameters: [{ name: 'path', type: 'string', required: true, description: 'File path to read' }],
    risk_level: 'low',
  });

  shed.register({
    name: 'file_write',
    description: 'Write or create a file on the filesystem',
    category: 'write',
    parameters: [
      { name: 'path', type: 'string', required: true, description: 'File path to write' },
      { name: 'content', type: 'string', required: true, description: 'Content to write' },
    ],
    risk_level: 'medium',
  });

  shed.register({
    name: 'file_edit',
    description: 'Edit an existing file with search and replace',
    category: 'write',
    parameters: [
      { name: 'path', type: 'string', required: true, description: 'File path' },
      { name: 'old_text', type: 'string', required: true, description: 'Text to find' },
      { name: 'new_text', type: 'string', required: true, description: 'Replacement text' },
    ],
    risk_level: 'medium',
  });

  shed.register({
    name: 'bash_execute',
    description: 'Execute a bash shell command',
    category: 'execute',
    parameters: [{ name: 'command', type: 'string', required: true, description: 'Command to run' }],
    risk_level: 'critical',
  });

  shed.register({
    name: 'grep_search',
    description: 'Search file contents using regex patterns',
    category: 'search',
    parameters: [
      { name: 'pattern', type: 'string', required: true, description: 'Regex pattern' },
      { name: 'path', type: 'string', required: false, description: 'Directory to search' },
    ],
    risk_level: 'low',
  });

  shed.register({
    name: 'glob_find',
    description: 'Find files matching glob patterns',
    category: 'search',
    parameters: [{ name: 'pattern', type: 'string', required: true, description: 'Glob pattern' }],
    risk_level: 'low',
  });

  shed.register({
    name: 'test_runner',
    description: 'Run the project test suite',
    category: 'execute',
    parameters: [{ name: 'filter', type: 'string', required: false, description: 'Test filter pattern' }],
    risk_level: 'low',
  });

  shed.register({
    name: 'code_analyzer',
    description: 'Analyze code for quality, complexity, and issues',
    category: 'analyze',
    parameters: [{ name: 'path', type: 'string', required: true, description: 'File or directory to analyze' }],
    risk_level: 'low',
  });

  shed.register({
    name: 'db_query',
    description: 'Execute a database query',
    category: 'execute',
    parameters: [{ name: 'query', type: 'string', required: true, description: 'SQL query' }],
    risk_level: 'high',
  });

  shed.register({
    name: 'deploy',
    description: 'Deploy application to production environment',
    category: 'execute',
    parameters: [{ name: 'target', type: 'string', required: true, description: 'Deployment target' }],
    risk_level: 'high',
  });

  return shed;
}
