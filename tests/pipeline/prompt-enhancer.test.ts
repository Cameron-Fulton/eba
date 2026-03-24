import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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

  describe('project-first NK search', () => {
    it('uses project NK entries first, fills from global', () => {
      const projectNk = {
        searchByKeyword: jest.fn().mockReturnValue([
          { scenario: 'proj-fail', attempt: 'did X', outcome: 'broke', solution: 'do Y', tags: [] },
          { scenario: 'proj-fail-2', attempt: 'did A', outcome: 'broke', solution: 'do B', tags: [] },
        ]),
      } as unknown as NegativeKnowledgeStore;

      const globalNk = {
        searchByKeyword: jest.fn().mockReturnValue([
          { scenario: 'global-fail', attempt: 'did Z', outcome: 'broke', solution: 'do W', tags: [] },
          { scenario: 'global-fail-2', attempt: 'did C', outcome: 'broke', solution: 'do D', tags: [] },
          { scenario: 'global-fail-3', attempt: 'did E', outcome: 'broke', solution: 'do F', tags: [] },
          { scenario: 'global-fail-4', attempt: 'did G', outcome: 'broke', solution: 'do H', tags: [] },
        ]),
      } as unknown as NegativeKnowledgeStore;

      const enhancer = makeEnhancer({
        negativeKnowledge: globalNk,
        projectNegativeKnowledge: projectNk,
        maxNkEntries: 5,
      });

      const result = enhancer.enhance('Fix the authentication login module error');

      expect(result).toContain('proj-fail');
      expect(result).toContain('proj-fail-2');
      expect(result).toContain('global-fail');
      expect(result).toContain('global-fail-2');
      expect(result).toContain('global-fail-3');
      expect(result).not.toContain('global-fail-4');
    });

    it('works with only global NK when no project NK provided', () => {
      const globalNk = {
        searchByKeyword: jest.fn().mockReturnValue([
          { scenario: 'global-only', attempt: 'did X', outcome: 'broke', solution: 'do Y', tags: [] },
        ]),
      } as unknown as NegativeKnowledgeStore;

      const enhancer = makeEnhancer({ negativeKnowledge: globalNk });
      const result = enhancer.enhance('Fix the authentication login module error');
      expect(result).toContain('global-only');
    });
  });
});

describe('NK injection tracking', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-nk-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('tracks injected NK entries', () => {
    const nkStore = new NegativeKnowledgeStore(tmpDir);
    const entry = nkStore.add({ scenario: 'deploy failure NTFS', attempt: 'symlinks', outcome: 'failed', solution: 'junctions', tags: ['jest'] });
    const enhancer = new PromptEnhancer({ provider: mockProvider, negativeKnowledge: nkStore, sop: mockSop, toolShed: mockToolShed });
    enhancer.enhance('deploy failure NTFS');
    const injected = enhancer.getInjectedNkEntries();
    expect(injected.length).toBeGreaterThan(0);
    expect(injected[0].id).toBe(entry.id);
  });

  it('clearInjectedNkEntries resets', () => {
    const nkStore = new NegativeKnowledgeStore(tmpDir);
    nkStore.add({ scenario: 'deploy failure NTFS', attempt: 'symlinks', outcome: 'failed', solution: 'junctions', tags: ['jest'] });
    const enhancer = new PromptEnhancer({ provider: mockProvider, negativeKnowledge: nkStore, sop: mockSop, toolShed: mockToolShed });
    enhancer.enhance('deploy failure NTFS');
    expect(enhancer.getInjectedNkEntries().length).toBeGreaterThan(0);
    enhancer.clearInjectedNkEntries();
    expect(enhancer.getInjectedNkEntries()).toEqual([]);
  });

  it('returns empty array before any enhance call', () => {
    const nkStore = new NegativeKnowledgeStore(tmpDir);
    const enhancer = new PromptEnhancer({ provider: mockProvider, negativeKnowledge: nkStore, sop: mockSop, toolShed: mockToolShed });
    expect(enhancer.getInjectedNkEntries()).toEqual([]);
  });

  it('returns a defensive copy', () => {
    const nkStore = new NegativeKnowledgeStore(tmpDir);
    nkStore.add({ scenario: 'deploy failure NTFS', attempt: 'symlinks', outcome: 'failed', solution: 'junctions', tags: ['jest'] });
    const enhancer = new PromptEnhancer({ provider: mockProvider, negativeKnowledge: nkStore, sop: mockSop, toolShed: mockToolShed });
    enhancer.enhance('deploy failure NTFS');
    const first = enhancer.getInjectedNkEntries();
    const second = enhancer.getInjectedNkEntries();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});
