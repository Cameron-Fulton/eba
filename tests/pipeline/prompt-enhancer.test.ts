import { PromptEnhancer, PromptEnhancerConfig } from '../../src/pipeline/prompt-enhancer';
import { LLMProvider } from '../../src/phase1/orchestrator';
import { NegativeKnowledgeStore } from '../../src/phase1/negative-knowledge';
import { SOPEngine } from '../../src/phase2/sop';
import { ToolShed } from '../../src/phase2/tool-shed';

// Minimal mock provider
const mockProvider: LLMProvider = {
  call: jest.fn().mockResolvedValue('mocked response'),
};

// Empty NK store: never returns failures
const emptyNk = {
  searchByKeyword: jest.fn().mockReturnValue([]),
} as unknown as NegativeKnowledgeStore;

// SOP with no active step
const mockSop = {
  getCurrentStep: jest.fn().mockReturnValue(null),
} as unknown as SOPEngine;

// ToolShed that selects nothing
const mockToolShed = {
  selectTools: jest.fn().mockReturnValue([]),
} as unknown as ToolShed;

function makeEnhancer(overrides: Partial<PromptEnhancerConfig> = {}): PromptEnhancer {
  return new PromptEnhancer({
    provider: mockProvider,
    negativeKnowledge: emptyNk,
    sop: mockSop,
    toolShed: mockToolShed,
    ...overrides,
  });
}

describe('PromptEnhancer', () => {
  describe('enhance()', () => {
    it('includes the original prompt under ## Task', () => {
      const enhancer = makeEnhancer();
      const result = enhancer.enhance('Fix the login bug');
      expect(result).toContain('## Task');
      expect(result).toContain('Fix the login bug');
    });

    it('injects projectContext at the start of the enhanced prompt', () => {
      const enhancer = makeEnhancer({
        projectContext: 'TypeScript monorepo, Node 20, Jest 29',
      });

      const result = enhancer.enhance('Fix the login bug');

      // Project context section must be present
      expect(result).toContain('## Project Context');
      expect(result).toContain('TypeScript monorepo, Node 20, Jest 29');

      // Project context must appear BEFORE the ## Task section
      const projectContextIndex = result.indexOf('## Project Context');
      const taskIndex = result.indexOf('## Task');
      expect(projectContextIndex).toBeLessThan(taskIndex);
    });

    it('does not inject ## Project Context when projectContext is not set', () => {
      const enhancer = makeEnhancer();
      const result = enhancer.enhance('Fix the login bug');
      expect(result).not.toContain('## Project Context');
    });

    it('does not inject ## Project Context when projectContext is empty string', () => {
      const enhancer = makeEnhancer({ projectContext: '' });
      const result = enhancer.enhance('Fix the login bug');
      expect(result).not.toContain('## Project Context');
    });
  });
});
