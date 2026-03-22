/**
 * Tests for ProjectOrchestrator — project-level task sequencing.
 */

import * as fs   from 'fs';
import * as os   from 'os';
import * as path from 'path';
import { ProjectOrchestrator } from '../../src/pipeline/project-orchestrator';
import { LLMProvider } from '../../src/phase1/orchestrator';
import { MemoryPacket } from '../../src/phase1/memory-packet';

function makeMockProvider(response = '0'): LLMProvider {
  return { call: jest.fn().mockResolvedValue(response) };
}

function writePacket(packetsDir: string, packet: Partial<MemoryPacket>, filename = 'packet.json') {
  const full: MemoryPacket = {
    id: 'pkt_test',
    timestamp: new Date().toISOString(),
    session_id: 'sess_test',
    summary: 'Test session summary',
    decisions: [],
    rejected_ideas: [],
    risks: [],
    open_threads: [],
    key_file_changes: [],
    metadata: {
      original_token_count: 100,
      compressed_token_count: 20,
      compression_ratio: 5,
      fidelity_score: 0.97,
    },
    ...packet,
  };
  fs.writeFileSync(path.join(packetsDir, filename), JSON.stringify(full, null, 2));
  return full;
}

describe('ProjectOrchestrator', () => {
  let tempDir: string;
  let docsDir: string;
  let packetsDir: string;

  beforeEach(() => {
    tempDir    = fs.mkdtempSync(path.join(os.tmpdir(), 'eba-orchestrator-'));
    docsDir    = path.join(tempDir, 'docs');
    packetsDir = path.join(tempDir, 'packets');
    fs.mkdirSync(docsDir,    { recursive: true });
    fs.mkdirSync(packetsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ── loadProjectGoal ────────────────────────────────────────────────────────

  describe('loadProjectGoal()', () => {
    test('returns empty string when PROJECT.md does not exist', () => {
      const orch = new ProjectOrchestrator({ docsDir, packetsDir, provider: makeMockProvider() });
      expect(orch.loadProjectGoal()).toBe('');
    });

    test('returns trimmed content of PROJECT.md', () => {
      fs.writeFileSync(path.join(docsDir, 'PROJECT.md'), `  # My Project\n\nBuild something great.  \n`);
      const orch = new ProjectOrchestrator({ docsDir, packetsDir, provider: makeMockProvider() });
      expect(orch.loadProjectGoal()).toBe(`# My Project\n\nBuild something great.`);
    });
  });

  // ── loadLatestPacket ───────────────────────────────────────────────────────

  describe('loadLatestPacket()', () => {
    test('returns null when packetsDir does not exist', () => {
      const orch = new ProjectOrchestrator({
        docsDir,
        packetsDir: path.join(tempDir, 'nonexistent'),
        provider: makeMockProvider(),
      });
      expect(orch.loadLatestPacket()).toBeNull();
    });

    test('returns null when no JSON packets exist', () => {
      fs.writeFileSync(path.join(packetsDir, '.gitkeep'), '');
      const orch = new ProjectOrchestrator({ docsDir, packetsDir, provider: makeMockProvider() });
      expect(orch.loadLatestPacket()).toBeNull();
    });

    test('returns the most recently modified packet', async () => {
      writePacket(packetsDir, { session_id: 'old' }, 'old.json');
      // small delay to ensure different mtime
      await new Promise(r => setTimeout(r, 10));
      writePacket(packetsDir, { session_id: 'new' }, 'new.json');

      const orch = new ProjectOrchestrator({ docsDir, packetsDir, provider: makeMockProvider() });
      const result = orch.loadLatestPacket();
      expect(result?.session_id).toBe('new');
    });

    test('returns null when packet JSON is malformed', () => {
      fs.writeFileSync(path.join(packetsDir, 'bad.json'), 'not valid json');
      const orch = new ProjectOrchestrator({ docsDir, packetsDir, provider: makeMockProvider() });
      expect(orch.loadLatestPacket()).toBeNull();
    });
  });

  // ── planNextTask — fresh project ───────────────────────────────────────────

  describe('planNextTask() — fresh project (no packets)', () => {
    test('returns null chosenTask and logs manual mode when no packets exist', async () => {
      const orch = new ProjectOrchestrator({ docsDir, packetsDir, provider: makeMockProvider() });
      const result = await orch.planNextTask();
      expect(result.chosenTask).toBeNull();
      expect(result.chosenThread).toBeNull();
      expect(result.openThreads).toHaveLength(0);
    });

    test('does not overwrite ACTIVE_TASK.md when no threads exist', async () => {
      fs.writeFileSync(path.join(docsDir, 'ACTIVE_TASK.md'), `# Existing Task\n\nDo the thing.`);
      const orch = new ProjectOrchestrator({ docsDir, packetsDir, provider: makeMockProvider() });
      await orch.planNextTask();
      const content = fs.readFileSync(path.join(docsDir, 'ACTIVE_TASK.md'), 'utf-8');
      expect(content).toContain('Existing Task');
    });
  });

  // ── planNextTask — all blocked ─────────────────────────────────────────────

  describe('planNextTask() — all threads blocked', () => {
    test('returns null chosenTask when every thread is blocked', async () => {
      writePacket(packetsDir, {
        open_threads: [
          { topic: 'Blocked thing', status: 'blocked', context: 'Waiting on external dep' },
        ],
      });
      const orch = new ProjectOrchestrator({ docsDir, packetsDir, provider: makeMockProvider() });
      const result = await orch.planNextTask();
      expect(result.chosenTask).toBeNull();
      expect(result.chosenThread).toBeNull();
      expect(result.openThreads).toHaveLength(1);
    });
  });

  // ── planNextTask — picks next_up first ────────────────────────────────────

  describe('planNextTask() — single next_up thread', () => {
    test('picks next_up thread without calling LLM and writes ACTIVE_TASK.md', async () => {
      const provider = makeMockProvider('0');
      writePacket(packetsDir, {
        open_threads: [
          { topic: 'Do the priority task', status: 'next_up', context: 'This must be done first' },
        ],
      });

      const orch = new ProjectOrchestrator({ docsDir, packetsDir, provider });
      const result = await orch.planNextTask();

      expect(result.chosenThread?.topic).toBe('Do the priority task');
      expect(result.chosenTask).toContain('Do the priority task');

      // LLM should NOT have been called — single next_up is deterministic
      expect(provider.call).not.toHaveBeenCalled();

      // ACTIVE_TASK.md must be written
      const written = fs.readFileSync(path.join(docsDir, 'ACTIVE_TASK.md'), 'utf-8');
      expect(written).toContain('Do the priority task');
      expect(written).toContain('This must be done first');
    });
  });

  // ── planNextTask — LLM selection among multiple ───────────────────────────

  describe('planNextTask() — multiple threads, uses LLM to select', () => {
    test('calls LLM and picks the thread at the returned index', async () => {
      const provider = makeMockProvider('1');  // LLM picks index 1
      writePacket(packetsDir, {
        open_threads: [
          { topic: 'First next_up task', status: 'next_up', context: 'Do this' },
          { topic: 'Higher priority', status: 'next_up', context: 'Do soon' },
        ],
      });

      const orch = new ProjectOrchestrator({ docsDir, packetsDir, provider });
      const result = await orch.planNextTask();

      expect(provider.call).toHaveBeenCalledTimes(1);
      expect(result.chosenThread?.topic).toBe('Higher priority');

      const written = fs.readFileSync(path.join(docsDir, 'ACTIVE_TASK.md'), 'utf-8');
      expect(written).toContain('Higher priority');
    });

    test('falls back to index 0 when LLM returns invalid index', async () => {
      const provider = makeMockProvider('999');  // out of range
      writePacket(packetsDir, {
        open_threads: [
          { topic: 'Task A', status: 'backlog', context: 'Context A' },
          { topic: 'Task B', status: 'backlog', context: 'Context B' },
        ],
      });

      const orch = new ProjectOrchestrator({ docsDir, packetsDir, provider });
      const result = await orch.planNextTask();
      expect(result.chosenThread?.topic).toBe('Task A');
    });

    test('falls back to index 0 when LLM throws', async () => {
      const provider: LLMProvider = {
        call: jest.fn().mockRejectedValue(new Error('network error')),
      };
      writePacket(packetsDir, {
        open_threads: [
          { topic: 'Task A', status: 'next_up', context: 'Context A' },
          { topic: 'Task B', status: 'next_up', context: 'Context B' },
        ],
      });

      const orch = new ProjectOrchestrator({ docsDir, packetsDir, provider });
      const result = await orch.planNextTask();
      expect(result.chosenThread?.topic).toBe('Task A');
    });
  });

  // ── planNextTask — ACTIVE_TASK.md format ──────────────────────────────────

  describe('planNextTask() — written task format', () => {
    test('written ACTIVE_TASK.md includes project context section when PROJECT.md exists', async () => {
      fs.writeFileSync(
        path.join(docsDir, 'PROJECT.md'),
        `# Build a great system\n\nThis is the goal.`
      );
      writePacket(packetsDir, {
        open_threads: [
          { topic: 'Implement feature X', status: 'next_up', context: 'Needed for launch' },
        ],
      });

      const orch = new ProjectOrchestrator({ docsDir, packetsDir, provider: makeMockProvider() });
      await orch.planNextTask();

      const written = fs.readFileSync(path.join(docsDir, 'ACTIVE_TASK.md'), 'utf-8');
      expect(written).toContain('# Active Task');
      expect(written).toContain('## Project Context');
      expect(written).toContain('Build a great system');
      expect(written).toContain('## Task');
      expect(written).toContain('Implement feature X');
      expect(written).toContain('## Context');
      expect(written).toContain('Needed for launch');
    });
  });

  // ── planNextTask — projectGoal propagated ─────────────────────────────────

  describe('planNextTask() — returns projectGoal', () => {
    test('result includes the project goal string', async () => {
      fs.writeFileSync(path.join(docsDir, 'PROJECT.md'), '# The Goal');
      const orch = new ProjectOrchestrator({ docsDir, packetsDir, provider: makeMockProvider() });
      const result = await orch.planNextTask();
      expect(result.projectGoal).toBe('# The Goal');
    });
  });

  // ── enqueueFromThreads ──────────────────────────────────────────────────

  describe('enqueueFromThreads()', () => {
    let queueDbPath: string;
    let queue: import('../../src/pipeline/task-queue').TaskQueue;

    beforeEach(() => {
      const { TaskQueue } = require('../../src/pipeline/task-queue');
      queueDbPath = path.join(tempDir, 'test-queue.db');
      queue = new TaskQueue(queueDbPath);
    });

    afterEach(() => {
      queue.close();
    });

    test('enqueues actionable threads from latest packet', () => {
      writePacket(packetsDir, {
        open_threads: [
          { topic: 'Build auth', status: 'next_up', context: 'Auth system needed' },
          { topic: 'Add logging', status: 'backlog', context: 'Nice to have' },
          { topic: 'Fix crash', status: 'blocked', context: 'Waiting on dep', blocked_reason: 'dep broken' },
        ],
      });
      const orch = new ProjectOrchestrator({ docsDir, packetsDir, provider: makeMockProvider() });
      const count = orch.enqueueFromThreads(queue);
      expect(count).toBe(2); // next_up + backlog, not blocked
      const stats = queue.peek();
      expect(stats.pending).toBe(2);
    });

    test('returns 0 when no packets exist', () => {
      const orch = new ProjectOrchestrator({ docsDir, packetsDir, provider: makeMockProvider() });
      const count = orch.enqueueFromThreads(queue);
      expect(count).toBe(0);
    });

    test('next_up threads get higher priority than backlog', () => {
      writePacket(packetsDir, {
        open_threads: [
          { topic: 'Backlog item', status: 'backlog', context: 'Low pri' },
          { topic: 'Next up item', status: 'next_up', context: 'High pri' },
        ],
      });
      const orch = new ProjectOrchestrator({ docsDir, packetsDir, provider: makeMockProvider() });
      orch.enqueueFromThreads(queue);
      // Claim should return next_up first (priority 10 > 0)
      const claimed = queue.claim('test_agent');
      expect(claimed).not.toBeNull();
      expect(claimed!.task).toContain('Next up item');
    });
  });
});
