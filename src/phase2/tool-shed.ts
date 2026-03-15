/**
 * Phase 2: Tool Shed (Meta-Agentics)
 * Centralized tool registry with schema definitions.
 * Lightweight Tool Selector picks only the 2-3 relevant tools per task.
 */

export interface ToolSchema {
  name: string;
  description: string;
  category: 'read' | 'write' | 'execute' | 'search' | 'analyze';
  parameters: ToolParameter[];
  risk_level: 'low' | 'medium' | 'high';
}

export interface ToolParameter {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export class ToolShed {
  private tools: Map<string, ToolSchema> = new Map();

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
}

/** Default tools that model a typical AI engineering environment */
export function createDefaultToolShed(): ToolShed {
  const shed = new ToolShed();

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
    risk_level: 'high',
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
