import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { EBAPipeline, EBAPipelineConfig } from '../../src/pipeline/eba-pipeline';
import { LLMProvider, TestRunner, TestResult } from '../../src/phase1/orchestrator';
import { SOPEngine, createRefactoringSOP } from '../../src/phase2/sop';
import { createDefaultToolShed } from '../../src/phase2/tool-shed';
import { ThreePillarModel } from '../../src/phase3/three-pillar-model';
import { ConsortiumVoter, VoteResult } from '../../src/phase3/consortium-voter';
import { VisualProofSystem, ProofContext, ProofReport } from '../../src/phase3/visual-proof';
import { NegativeKnowledgeStore } from '../../src/phase1/negative-knowledge';
import { VoteReceipt } from '../../src/pipeline/nk-vote-tracker';

describe('EBAPipeline Integration', () => {
  let tempDir: string;
  let docsDir: string;
  let logsDir: string;
  let packetsDir: string;
  let solutionsDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eba-pipeline-int-'));
    docsDir = path.join(tempDir, 'docs');
    logsDir = path.join(tempDir, 'logs');
    packetsDir = path.join(tempDir, 'packets');
    solutionsDir = path.join(tempDir, 'solutions');

    fs.mkdirSync(docsDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });
    fs.mkdirSync(packetsDir, { recursive: true });
    fs.mkdirSync(solutionsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const COMPRESSION_RESPONSE = JSON.stringify({
    summary: 'Session summary',
    decisions: [],
    rejected_ideas: [],
    risks: [],
    open_threads: [],
    key_file_changes: [],
  });

  function createSopEngine(): SOPEngine {
    const sop = new SOPEngine();
    sop.register(createRefactoringSOP());
    return sop;
  }

  function createMockTestRunner(passed: boolean): TestRunner {
    return {
      run: jest.fn().mockResolvedValue({
        passed,
        output: passed ? 'All tests passed' : 'Tests failed',
        duration_ms: 10,
      } as TestResult),
    };
  }

  function createMockConsortiumVoter(
    voteImpl?: jest.MockedFunction<(prompt: string) => Promise<VoteResult>>
  ): { consortiumVoter: ConsortiumVoter; voteMock: jest.MockedFunction<(prompt: string) => Promise<VoteResult>> } {
    const defaultVote = jest.fn().mockResolvedValue({
      consensus: 'mock consensus',
      confidence: 0.7,
      total_votes: 3,
      cluster_size: 2,
      all_responses: [
        { provider: 'a', response: 'mock consensus', latency_ms: 10 },
        { provider: 'b', response: 'mock consensus', latency_ms: 12 },
        { provider: 'c', response: 'different', latency_ms: 11 },
      ],
      clusters: [
        { representative: 'mock consensus', members: ['a', 'b'], size: 2 },
      ],
    } as VoteResult);

    const voteMock = voteImpl ?? defaultVote;
    const consortiumVoter = { vote: voteMock } as unknown as ConsortiumVoter;
    return { consortiumVoter, voteMock };
  }

  function createConfig(overrides: Partial<EBAPipelineConfig> = {}): EBAPipelineConfig {
    const primaryProvider: LLMProvider = {
      call: jest.fn().mockResolvedValue('primary provider response'),
    };

    const routineProvider: LLMProvider = {
      call: jest.fn().mockResolvedValue(COMPRESSION_RESPONSE),
    };

    const { consortiumVoter } = createMockConsortiumVoter();

    return {
      docsDir,
      logsDir,
      packetsDir,
      solutionsDir,
      primaryProvider,
      routineProvider,
      consortiumVoter,
      sop: createSopEngine(),
      sopId: 'refactoring',
      toolShed: createDefaultToolShed(),
      threePillar: new ThreePillarModel(),
      testRunner: createMockTestRunner(true),
      approvalMode: 'dev',
      ...overrides,
    };
  }

  describe('1) HAPPY PATH', () => {
    test('pipeline succeeds on first attempt and writes packet with no negative knowledge entries', async () => {
      fs.writeFileSync(path.join(docsDir, 'ACTIVE_TASK.md'), 'Implement a tiny feature and run tests');

      const primaryProvider: LLMProvider = {
        call: jest.fn().mockResolvedValue('implemented feature'),
      };

      const routineProvider: LLMProvider = {
        call: jest.fn().mockResolvedValue(COMPRESSION_RESPONSE),
      };

      const pipeline = new EBAPipeline(
        createConfig({
          primaryProvider,
          routineProvider,
          testRunner: createMockTestRunner(true),
        })
      );

      const result = await pipeline.run();

      expect(result.status).toBe('success');
      expect(result.attempts).toBe(1);

      const packetFiles = fs.readdirSync(packetsDir).filter(f => f.endsWith('.json'));
      expect(packetFiles.length).toBe(1);

      const solutionFiles = fs.readdirSync(solutionsDir).filter(f => f.endsWith('.md'));
      expect(solutionFiles.length).toBe(0);
    });
  });

  describe('2) RALPH WIGGUM RETRY', () => {
    test('fails once then succeeds on second attempt with one recorded failure and packet written', async () => {
      fs.writeFileSync(path.join(docsDir, 'ACTIVE_TASK.md'), 'Fix flaky behavior');

      let testCallCount = 0;
      const testRunner: TestRunner = {
        run: jest.fn().mockImplementation(async () => {
          testCallCount += 1;
          if (testCallCount === 1) {
            return {
              passed: false,
              output: 'First run failed',
              duration_ms: 10,
            } as TestResult;
          }

          return {
            passed: true,
            output: 'Second run passed',
            duration_ms: 10,
          } as TestResult;
        }),
      };

      let llmCallCount = 0;
      const primaryProvider: LLMProvider = {
        call: jest.fn().mockImplementation(async () => {
          llmCallCount += 1;
          return llmCallCount === 2
            ? 'second attempt with retry approach'
            : 'first attempt naive approach';
        }),
      };

      const routineProvider: LLMProvider = {
        call: jest.fn().mockResolvedValue(COMPRESSION_RESPONSE),
      };

      const pipeline = new EBAPipeline(
        createConfig({
          primaryProvider,
          routineProvider,
          testRunner,
          maxRetries: 3,
        })
      );

      const result = await pipeline.run();

      expect(result.status).toBe('success');
      expect(result.attempts).toBe(2);
      expect(primaryProvider.call).toHaveBeenCalledTimes(2);
      expect(result.logs[1].llm_response).toContain('retry approach');

      const solutionFiles = fs.readdirSync(solutionsDir).filter(f => f.endsWith('.md'));
      expect(solutionFiles.length).toBe(1);

      const packetFiles = fs.readdirSync(packetsDir).filter(f => f.endsWith('.json'));
      expect(packetFiles.length).toBe(1);
    });
  });

  describe('3) FULL FAILURE', () => {
    test('exhausts retries, records all failures, calls consortium voter, and still writes packet', async () => {
      fs.writeFileSync(path.join(docsDir, 'ACTIVE_TASK.md'), 'Attempt impossible fix');

      const testRunner: TestRunner = {
        run: jest.fn().mockResolvedValue({
          passed: false,
          output: 'Always failing',
          duration_ms: 10,
        } as TestResult),
      };

      const primaryProvider: LLMProvider = {
        call: jest.fn().mockResolvedValue('attempted fix'),
      };

      const routineProvider: LLMProvider = {
        call: jest.fn().mockResolvedValue(COMPRESSION_RESPONSE),
      };

      const voteMock = jest.fn().mockResolvedValue({
        consensus: 'mock consensus',
        confidence: 0.7,
        total_votes: 3,
        cluster_size: 2,
        all_responses: [
          { provider: 'a', response: 'mock consensus', latency_ms: 10 },
          { provider: 'b', response: 'mock consensus', latency_ms: 10 },
          { provider: 'c', response: 'alternate', latency_ms: 10 },
        ],
        clusters: [{ representative: 'mock consensus', members: ['a', 'b'], size: 2 }],
      } as VoteResult);
      const { consortiumVoter } = createMockConsortiumVoter(voteMock);

      const pipeline = new EBAPipeline(
        createConfig({
          primaryProvider,
          routineProvider,
          consortiumVoter,
          testRunner,
          maxRetries: 2,
        })
      );

      const result = await pipeline.run();

      expect(result.status).toBe('failure');
      expect(result.attempts).toBe(2);

      const solutionFiles = fs.readdirSync(solutionsDir).filter(f => f.endsWith('.md'));
      expect(solutionFiles.length).toBe(2);

      expect(voteMock).toHaveBeenCalledTimes(1);

      const packetFiles = fs.readdirSync(packetsDir).filter(f => f.endsWith('.json'));
      expect(packetFiles.length).toBe(1);
    });
  });

  describe('4) PROMPT ENHANCEMENT', () => {
    test('injects Known Failures and SOP step context into provider prompt', async () => {
      fs.writeFileSync(path.join(docsDir, 'ACTIVE_TASK.md'), 'Refactor parser safely');

      const negativeKnowledge = new NegativeKnowledgeStore(solutionsDir);
      negativeKnowledge.add({
        // PromptEnhancer currently searches against the full prompt string,
        // which includes the "Task:" prefix from orchestrator prompts.
        scenario: 'Task: Refactor parser safely',
        attempt: 'Removed parser guard and introduced regression',
        outcome: 'Tests failed with parser crash',
        solution: 'Keep guard and refactor incrementally',
        tags: ['parser', 'refactor'],
      });
      negativeKnowledge.saveToDisk();

      let capturedPrompt = '';
      const primaryProvider: LLMProvider = {
        call: jest.fn().mockImplementation(async (prompt: string) => {
          capturedPrompt = prompt;
          return 'implemented safer parser changes';
        }),
      };

      const routineProvider: LLMProvider = {
        call: jest.fn().mockResolvedValue(COMPRESSION_RESPONSE),
      };

      const pipeline = new EBAPipeline(
        createConfig({
          primaryProvider,
          routineProvider,
          testRunner: createMockTestRunner(true),
        })
      );

      await pipeline.run();

      expect(capturedPrompt).toContain('Known Failures');
      expect(capturedPrompt).toContain('Analyze Code');
    });
  });

  describe('5) SOP ADVANCEMENT', () => {
    test('starts at analyze and advances past initial step', async () => {
      fs.writeFileSync(path.join(docsDir, 'ACTIVE_TASK.md'), 'Simple successful task');

      const sop = createSopEngine();
      const pipeline = new EBAPipeline(
        createConfig({
          sop,
          testRunner: createMockTestRunner(true),
        })
      );

      await pipeline.run();

      const history = sop.getHistory();
      expect(history[0]).toBe('analyze');
      expect(sop.getCurrentStep()?.id).not.toBe('analyze');
    });
  });

  describe('6) SESSION ID OVERRIDE', () => {
    test('uses custom sessionId in result and packet filename', async () => {
      fs.writeFileSync(path.join(docsDir, 'ACTIVE_TASK.md'), 'Task with custom session id');

      const customSessionId = 'test-session-123';
      const pipeline = new EBAPipeline(
        createConfig({
          sessionId: customSessionId,
          testRunner: createMockTestRunner(true),
        })
      );

      const result = await pipeline.run();

      expect(result.sessionId).toBe(customSessionId);

      const expectedPacketPath = path.join(packetsDir, `${customSessionId}.json`);
      expect(fs.existsSync(expectedPacketPath)).toBe(true);
    });
  });

  describe('7) NO ACTIVE TASK', () => {
    test('rejects when ACTIVE_TASK.md is missing', async () => {
      const pipeline = new EBAPipeline(createConfig());

      await expect(pipeline.run()).rejects.toThrow(/active task/i);
    });
  });

  describe('8) VISUAL PROOF', () => {
    test('fires post_test hook on success and writes demo markdown report', async () => {
      fs.writeFileSync(path.join(docsDir, 'ACTIVE_TASK.md'), 'Task that should trigger visual proof');

      const visualProofSystem = new VisualProofSystem();
      const hookExecute = jest.fn().mockResolvedValue({
        task: 'Task that should trigger visual proof',
        timestamp: new Date().toISOString(),
        status: 'verified',
        screenshots: [],
        checks: [{ description: 'UI check', passed: true }],
        markdown: '# Visual Proof Report\n\n- ✅ UI check passed',
      } as ProofReport);

      visualProofSystem.registerHook({
        name: 'post-test-proof',
        trigger: 'post_test',
        execute: async (context: ProofContext) => hookExecute(context),
      });

      const demoPath = path.join(tempDir, 'demo.md');

      const pipeline = new EBAPipeline(
        createConfig({
          testRunner: createMockTestRunner(true),
          visualProofSystem,
          visualProofOutputPath: demoPath,
        })
      );

      const result = await pipeline.run();

      expect(result.status).toBe('success');
      expect(hookExecute).toHaveBeenCalledTimes(1);
      expect(fs.existsSync(demoPath)).toBe(true);
      expect(fs.readFileSync(demoPath, 'utf-8')).toContain('Visual Proof Report');
    });
  });

  describe('9) VOTE RECEIPTS', () => {
    test('attaches vote_receipts to written packet when NK entries are injected', async () => {
      fs.writeFileSync(path.join(docsDir, 'ACTIVE_TASK.md'), 'Refactor parser module safely');

      // Pre-populate NK solutions dir with an entry whose scenario overlaps with the task
      // Include "Task:" prefix because PromptEnhancer searches against the full prompt
      // which includes the "Task:" prefix from orchestrator prompts.
      const negativeKnowledge = new NegativeKnowledgeStore(solutionsDir);
      negativeKnowledge.add({
        scenario: 'Task: Refactor parser module safely',
        attempt: 'Removed parser guard and introduced regression',
        outcome: 'Tests failed with parser crash',
        solution: 'Keep guard and refactor incrementally',
        tags: ['parser', 'refactor'],
      });
      negativeKnowledge.saveToDisk();

      const primaryProvider: LLMProvider = {
        call: jest.fn().mockResolvedValue('implemented safer parser changes'),
      };

      const routineProvider: LLMProvider = {
        call: jest.fn().mockResolvedValue(COMPRESSION_RESPONSE),
      };

      const pipeline = new EBAPipeline(
        createConfig({
          primaryProvider,
          routineProvider,
          testRunner: createMockTestRunner(true),
        })
      );

      const result = await pipeline.run();

      expect(result.status).toBe('success');
      expect(result.packetPath).not.toBeNull();

      // Read the written packet and verify vote_receipts
      const packetJson = JSON.parse(fs.readFileSync(result.packetPath!, 'utf-8'));
      expect(packetJson.vote_receipts).toBeDefined();
      expect(Array.isArray(packetJson.vote_receipts)).toBe(true);
      expect(packetJson.vote_receipts.length).toBeGreaterThan(0);

      const receipt = packetJson.vote_receipts[0] as VoteReceipt;
      expect(receipt.nk_id).toBeDefined();
      expect(receipt.context_keys).toBeDefined();
      expect(Array.isArray(receipt.context_keys)).toBe(true);
      expect(receipt.succeeded).toBe(true);
      expect(receipt.timestamp).toBeDefined();
    });

    test('does not attach vote_receipts when no NK entries are injected', async () => {
      fs.writeFileSync(path.join(docsDir, 'ACTIVE_TASK.md'), 'Totally unique task with no NK matches xyzzy');

      const pipeline = new EBAPipeline(
        createConfig({
          testRunner: createMockTestRunner(true),
        })
      );

      const result = await pipeline.run();

      expect(result.status).toBe('success');
      expect(result.packetPath).not.toBeNull();

      const packetJson = JSON.parse(fs.readFileSync(result.packetPath!, 'utf-8'));
      expect(packetJson.vote_receipts).toBeUndefined();
    });
  });
});
