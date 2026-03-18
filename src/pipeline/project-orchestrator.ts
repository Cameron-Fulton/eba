/**
 * Project Orchestrator
 *
 * Implements project-level task sequencing on top of the single-task pipeline:
 *   1. Reads docs/PROJECT.md to understand the overarching goal
 *   2. Loads the latest memory packet to inspect open_threads
 *   3. Uses an LLM to pick the highest-priority next_up or backlog thread
 *   4. Writes the chosen task into docs/ACTIVE_TASK.md
 *
 * This runs BEFORE each pipeline execution (boot planning step) and is
 * triggered AFTER each task completes (seamless loop continuation).
 */

import * as fs   from 'fs';
import * as path from 'path';
import { LLMProvider } from '../phase1/orchestrator';
import { OpenThread, MemoryPacket, deserializePacket } from '../phase1/memory-packet';

export interface ProjectOrchestratorConfig {
  /** Directory containing PROJECT.md and ACTIVE_TASK.md */
  docsDir:    string;
  /** Directory containing memory packet JSON files */
  packetsDir: string;
  /** Cheap/fast provider for planning decisions */
  provider:   LLMProvider;
}

export interface PlanningResult {
  /** The task written into ACTIVE_TASK.md, or null if no work remains */
  chosenTask:    string | null;
  /** The thread that was selected, if any */
  chosenThread:  OpenThread | null;
  /** The project goal loaded from PROJECT.md */
  projectGoal:   string;
  /** All threads considered */
  openThreads:   OpenThread[];
}

export class ProjectOrchestrator {
  private config: ProjectOrchestratorConfig;

  constructor(config: ProjectOrchestratorConfig) {
    this.config = config;
  }

  /**
   * Main entry point.
   * Reads PROJECT.md + latest packet, picks next task, writes ACTIVE_TASK.md.
   * Returns null if no actionable work remains.
   */
  async planNextTask(): Promise<PlanningResult> {
    const projectGoal = this.loadProjectGoal();
    const latestPacket = this.loadLatestPacket();
    const openThreads: OpenThread[] = latestPacket?.open_threads ?? [];

    // Actionable = next_up or backlog. Active threads are already in-flight this session;
    // blocked threads need external resolution. Neither should be auto-selected here.
    const actionable = openThreads.filter(
      t => t.status === 'next_up' || t.status === 'backlog'
    );

    if (openThreads.length === 0) {
      // Fresh project — no prior memory packets or all packets have empty thread lists.
      // Leave ACTIVE_TASK.md untouched so a manually written task can run.
      console.log('📋 [Orchestrator] No prior open threads — using existing ACTIVE_TASK.md');
      return { chosenTask: null, chosenThread: null, projectGoal, openThreads };
    }

    if (actionable.length === 0) {
      // All known threads are either active (in-flight) or blocked (waiting externally).
      // Cannot auto-select — surface this so the user can unblock manually.
      console.log('⛔ [Orchestrator] All open threads are blocked — cannot proceed automatically');
      return { chosenTask: null, chosenThread: null, projectGoal, openThreads };
    }

    // Use LLM to pick the highest priority task
    const recentSummary = latestPacket?.summary ?? 'No prior session summary available.';
    const chosenThread = await this.pickNextThread(projectGoal, actionable, recentSummary);
    if (!chosenThread) {
      return { chosenTask: null, chosenThread: null, projectGoal, openThreads };
    }

    // Write chosen task to ACTIVE_TASK.md
    const taskContent = this.buildTaskContent(chosenThread, projectGoal);
    const activeTaskPath = path.join(this.config.docsDir, 'ACTIVE_TASK.md');
    fs.writeFileSync(activeTaskPath, taskContent, 'utf-8');

    console.log(`📋 [Orchestrator] Selected next task: ${chosenThread.topic}`);
    return { chosenTask: taskContent, chosenThread, projectGoal, openThreads };
  }

  /**
   * Reads PROJECT.md. Returns empty string if file doesn't exist.
   */
  loadProjectGoal(): string {
    const projectPath = path.join(this.config.docsDir, 'PROJECT.md');
    if (!fs.existsSync(projectPath)) return '';
    return fs.readFileSync(projectPath, 'utf-8').trim();
  }

  /**
   * Finds and loads the most recent memory packet from packetsDir.
   * Returns null if no packets exist.
   */
  loadLatestPacket(): MemoryPacket | null {
    if (!fs.existsSync(this.config.packetsDir)) return null;

    const files = fs.readdirSync(this.config.packetsDir)
      .filter(f => f.endsWith('.json') && f !== '.gitkeep')
      .map(f => ({
        name: f,
        mtime: fs.statSync(path.join(this.config.packetsDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) return null;

    try {
      const content = fs.readFileSync(
        path.join(this.config.packetsDir, files[0].name),
        'utf-8'
      );
      return deserializePacket(content);
    } catch {
      return null;
    }
  }

  /**
   * Calls the LLM to select the highest-priority actionable thread.
   */
  private async pickNextThread(
    projectGoal:   string,
    actionable:    OpenThread[],
    recentSummary: string
  ): Promise<OpenThread | null> {
    // next_up threads always take priority — if any exist, pick the first without LLM
    const nextUp = actionable.filter(t => t.status === 'next_up');
    if (nextUp.length === 1) return nextUp[0];

    // If multiple threads, use LLM to rank them
    // Sanitize thread content to prevent prompt injection
    const sanitizeField = (s: string) => s
      .replace(/^(ignore|disregard|forget|system|assistant|user|\[INST\]).*/gim, '[filtered]')
      .slice(0, 500)
      .trim();

    const threadList = actionable
      .map((t, i) => `[${i}] (${t.status}) ${sanitizeField(t.topic)}\n    Context: ${sanitizeField(t.context)}`)
      .join('\n');

    const prompt = [
      '## Project Goal',
      projectGoal || 'No PROJECT.md found.',
      '',
      '## Recent Session Summary',
      recentSummary,
      '',
      '## Open Threads (actionable)',
      threadList,
      '',
      '## Task',
      'You are a project orchestrator. Select the single most important thread to work on next.',
      'Prefer next_up over backlog. Within the same status, prefer foundational work that unblocks other threads.',
      'Respond with ONLY the index number of your choice (e.g. "0" or "2"). No explanation.',
    ].join('\n');

    try {
      const response = await this.config.provider.call(prompt);
      const idx = parseInt(response.trim().replace(/[^0-9]/g, ''), 10);
      if (!isNaN(idx) && idx >= 0 && idx < actionable.length) {
        return actionable[idx];
      }
    } catch {
      // Fall back to first actionable thread
    }

    return actionable[0];
  }

  /**
   * Formats the chosen thread as an ACTIVE_TASK.md task specification.
   */
  private buildTaskContent(thread: OpenThread, projectGoal: string): string {
    return [
      '# Active Task',
      '',
      `## Project Context`,
      // First 5 lines — enough to convey the goal without bloating ACTIVE_TASK.md
      projectGoal ? projectGoal.split('\n').slice(0, 5).join('\n') : '(see PROJECT.md)',
      '',
      '## Task',
      thread.topic,
      '',
      '## Context',
      thread.context,
    ].join('\n');
  }
}
