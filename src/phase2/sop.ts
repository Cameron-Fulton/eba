/**
 * Phase 2: Standard Operating Procedures (SOPs)
 * Decision graphs that map workflow steps to allowed tools.
 * The orchestrator filters available tools based on the current SOP step.
 */

export interface SOPStep {
  id: string;
  name: string;
  description: string;
  allowed_tool_categories: Array<'read' | 'write' | 'execute' | 'search' | 'analyze'>;
  allowed_tools?: string[]; // specific tool names, overrides categories if set
  next_steps: string[]; // IDs of possible next steps
  requires_approval?: boolean;
}

export interface SOPDefinition {
  id: string;
  name: string;
  description: string;
  steps: SOPStep[];
  initial_step: string;
}

export class SOPEngine {
  private sops: Map<string, SOPDefinition> = new Map();
  private currentSop: SOPDefinition | null = null;
  private currentStepId: string | null = null;
  private history: string[] = [];

  register(sop: SOPDefinition): void {
    // Validate that initial_step exists
    const stepIds = new Set(sop.steps.map(s => s.id));
    if (!stepIds.has(sop.initial_step)) {
      throw new Error(`Initial step '${sop.initial_step}' not found in SOP '${sop.id}'`);
    }
    // Validate all next_steps references
    for (const step of sop.steps) {
      for (const next of step.next_steps) {
        if (!stepIds.has(next)) {
          throw new Error(`Step '${step.id}' references unknown next step '${next}'`);
        }
      }
    }
    this.sops.set(sop.id, sop);
  }

  start(sopId: string): SOPStep {
    const sop = this.sops.get(sopId);
    if (!sop) throw new Error(`SOP '${sopId}' not found`);
    this.currentSop = sop;
    this.currentStepId = sop.initial_step;
    this.history = [sop.initial_step];
    return this.getCurrentStep()!;
  }

  advance(nextStepId: string): SOPStep {
    const current = this.getCurrentStep();
    if (!current) throw new Error('No active SOP step');
    if (!current.next_steps.includes(nextStepId)) {
      throw new Error(`Cannot advance to '${nextStepId}' from '${current.id}'. Valid: ${current.next_steps.join(', ')}`);
    }
    this.currentStepId = nextStepId;
    this.history.push(nextStepId);
    return this.getCurrentStep()!;
  }

  getCurrentStep(): SOPStep | null {
    if (!this.currentSop || !this.currentStepId) return null;
    return this.currentSop.steps.find(s => s.id === this.currentStepId) ?? null;
  }

  getAllowedToolCategories(): Array<'read' | 'write' | 'execute' | 'search' | 'analyze'> {
    const step = this.getCurrentStep();
    if (!step) return [];
    return step.allowed_tool_categories;
  }

  getAllowedToolNames(): string[] | null {
    const step = this.getCurrentStep();
    if (!step) return null;
    return step.allowed_tools ?? null;
  }

  isToolAllowed(toolName: string, toolCategory: string): boolean {
    const step = this.getCurrentStep();
    if (!step) return false;

    // Specific tool list takes precedence
    if (step.allowed_tools) {
      return step.allowed_tools.includes(toolName);
    }

    return step.allowed_tool_categories.includes(toolCategory as SOPStep['allowed_tool_categories'][number]);
  }

  requiresApproval(): boolean {
    const step = this.getCurrentStep();
    return step?.requires_approval ?? false;
  }

  getHistory(): string[] {
    return [...this.history];
  }

  getRegisteredSOPs(): SOPDefinition[] {
    return Array.from(this.sops.values());
  }
}

/** Example: A standard code refactoring SOP */
export function createRefactoringSOP(): SOPDefinition {
  return {
    id: 'refactoring',
    name: 'Standard Refactoring Workflow',
    description: 'Refactor existing code into smaller, cleaner functions to improve clarity and maintainability without changing behavior, then verify tests still pass',
    initial_step: 'analyze',
    steps: [
      {
        id: 'analyze',
        name: 'Analyze Code',
        description: 'Read and understand the code to be refactored',
        allowed_tool_categories: ['read', 'search', 'analyze'],
        next_steps: ['plan'],
      },
      {
        id: 'plan',
        name: 'Plan Changes',
        description: 'Create a plan for the refactoring changes',
        allowed_tool_categories: ['read', 'search', 'analyze'],
        next_steps: ['implement'],
      },
      {
        id: 'implement',
        name: 'Implement Changes',
        description: 'Apply the planned refactoring changes',
        allowed_tool_categories: ['read', 'write', 'search'],
        next_steps: ['test'],
      },
      {
        id: 'test',
        name: 'Run Tests',
        description: 'Execute tests to verify refactoring correctness',
        allowed_tool_categories: ['read', 'execute'],
        next_steps: ['analyze', 'implement', 'complete'],
      },
      {
        id: 'complete',
        name: 'Complete',
        description: 'Refactoring is complete and verified',
        allowed_tool_categories: ['read'],
        next_steps: [],
      },
    ],
  };
}
