/**
 * EBA Pipeline — Phase Integration Layer
 *
 * Connects all four phases into a single coherent execution pipeline:
 *
 *  PRE-TASK
 *   1. Load negative knowledge from disk
 *   2. Start SOP on initial step
 *   3. PromptEnhancer wraps the LLM provider — injects NK + SOP + tools into every prompt
 *
 *  DURING TASK (per attempt, via orchestrator)
 *   4. ThreePillarModel logs each state transition
 *   5. If attempt > 1 and failing → escalate to ConsortiumVoter for consensus
 *
 *  POST-TASK
 *   6. Failed attempts → recorded to NegativeKnowledgeStore, saved to disk
 *   7. CompressionAgent compresses the session into a MemoryPacket
 *   8. MemoryPacket written to docs/memory-packets/
 */

import * as fs   from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

import { LLMProvider }              from '../phase1/orchestrator';
import { BlueprintOrchestrator, OrchestratorConfig, ExecutionLog } from '../phase1/orchestrator';
import { NegativeKnowledgeStore, NegativeKnowledgeEntry } from '../phase1/negative-knowledge';
import { CompressionAgent }         from '../phase1/compression-agent';
import { ToolShed }                 from '../phase2/tool-shed';
import { SOPEngine }                from '../phase2/sop';
import { ThreadManager, Episode }   from '../phase2/thread-manager';
import { createOrchestratorExecutor } from '../phase2/thread-executor';
import { ConsortiumVoter }          from '../phase3/consortium-voter';
import { ThreePillarModel }         from '../phase3/three-pillar-model';
import { VisualProofSystem, ProofContext } from '../phase3/visual-proof';
import { PromptEnhancer }           from './prompt-enhancer';
import { ProjectOrchestrator }      from './project-orchestrator';
import { NKPromoter }               from './nk-promoter';
import { createVoteReceipts, VoteReceipt } from './nk-vote-tracker';

export interface EBAPipelineConfig {
  /** Directory containing ACTIVE_TASK.md, PROJECT.md */
  docsDir:           string;
  /** Directory for execution logs */
  logsDir:           string;
  /** Directory for memory packets */
  packetsDir:        string;
  /** Directory for negative knowledge markdown files */
  solutionsDir:      string;
  /** Primary LLM provider for coding tasks */
  primaryProvider:   LLMProvider;
  /** Cheap/fast provider for compression (Haiku or Flash) */
  routineProvider:   LLMProvider;
  /** Consortium voter for complex/failing tasks */
  consortiumVoter:   ConsortiumVoter;
  /** Pre-configured SOP engine with SOPs registered */
  sop:               SOPEngine;
  /** SOP id to run for this pipeline execution */
  sopId:             string;
  /** Pre-configured tool shed */
  toolShed:          ToolShed;
  /** Pre-configured 3PM */
  threePillar:       ThreePillarModel;
  /** Shell test runner */
  testRunner:        OrchestratorConfig['testRunner'];
  /** Max attempts before giving up (default: 3) */
  maxRetries?:       number;
  /** Context saturation threshold in tokens (default: 50000) */
  contextSaturationThreshold?: number;
  /** Session id for memory packet (default: auto-generated) */
  sessionId?:        string;
  /** Optional visual proof system — registers post_test hooks run after a successful attempt */
  visualProofSystem?: VisualProofSystem;
  /** Path to write the proof markdown report (default: docs/demo.md relative to docsDir parent) */
  visualProofOutputPath?: string;
  /**
   * Risk enforcement mode for the Three-Pillar Model.
   * - 'dev': auto-approve everything (explicit opt-in only; not for production)
   * - 'strict': deny all high/critical actions automatically
   * - 'configurable': use the approvalHandler provided on the ThreePillarModel instance
   */
  approvalMode?: 'dev' | 'strict' | 'configurable';
  /**
   * Optional project orchestrator — when provided, runs planning after each task
   * completes and automatically loads the next task into ACTIVE_TASK.md.
   */
  projectOrchestrator?: ProjectOrchestrator;
  /** Thread manager config (default: timeout_ms=120000, max_concurrent=1) */
  threadManagerConfig?: { timeout_ms: number; max_concurrent: number; maxEpisodeHistory?: number };
  /** Override path for the active task file. Defaults to docs/ACTIVE_TASK.md. */
  activeTaskPath?: string;
  /** Directory for pending merge packets. When set, pipeline writes result packets here. */
  pendingMergeDir?: string;
  /** Project context string to inject into prompts */
  projectContext?: string;
  /** Target project directory (overrides ROOT_DIR for test runner cwd) */
  targetProjectDir?: string;
  /** Project-specific NK store. When targeting external projects, new NK entries write here. */
  projectNkStore?: NegativeKnowledgeStore;
  /** NK promoter for project-to-global knowledge propagation */
  nkPromoter?: NKPromoter;
}

export interface PipelineResult {
  status:       'success' | 'failure';
  attempts:     number;
  logs:         ExecutionLog[];
  packetPath:   string | null;
  sessionId:    string;
}

export class EBAPipeline {
  private config: EBAPipelineConfig;
  private negativeKnowledge: NegativeKnowledgeStore;
  private sessionId: string;
  constructor(config: EBAPipelineConfig) {
    this.config = config;
    this.negativeKnowledge = new NegativeKnowledgeStore(config.solutionsDir);
    this.sessionId = config.sessionId ?? `session_${Date.now()}_${randomUUID().replace(/-/g, '').substring(0, 8)}`;
    this.applyApprovalMode();
  }

  async run(): Promise<PipelineResult> {
    // ── PRE-TASK ──────────────────────────────────────────────────────────────

    // 1. Load negative knowledge from disk
    this.negativeKnowledge.loadFromDisk();
    const nkCount = this.negativeKnowledge.getAll().length;
    console.log(`📚 Loaded ${nkCount} negative knowledge entr${nkCount === 1 ? 'y' : 'ies'}`);

    // 2. Start SOP
    const initialStep = this.config.sop.start(this.config.sopId);
    console.log(`📋 SOP started: ${initialStep.name}`);

    const activeTaskPath = this.config.activeTaskPath
      ?? path.join(this.config.docsDir, 'ACTIVE_TASK.md');
    const activeTask = fs.existsSync(activeTaskPath)
      ? fs.readFileSync(activeTaskPath, 'utf-8').trim()
      : null;

    if (!activeTask) {
      throw new Error('No active task found in ACTIVE_TASK.md');
    }

    // 3. Wrap primary provider with prompt enhancer
    const enhancer = new PromptEnhancer({
      provider:          this.config.primaryProvider,
      negativeKnowledge: this.negativeKnowledge,
      sop:               this.config.sop,
      toolShed:          this.config.toolShed,
      projectContext:    this.config.projectContext,
      projectNegativeKnowledge: this.config.projectNkStore,
    });

    // Log pre-task state via 3PM
    this.config.threePillar.logStateChange(
      'pipeline', 'task_start', 'idle', 'running'
    );

    // ── RUN ORCHESTRATOR ──────────────────────────────────────────────────────

    const orchestrator = new BlueprintOrchestrator({
      docsDir:                    this.config.docsDir,
      logsDir:                    this.config.logsDir,
      maxRetries:                 this.config.maxRetries ?? 3,
      contextSaturationThreshold: this.config.contextSaturationThreshold ?? 50_000,
      llmProvider:                enhancer,
      testRunner:                 this.config.testRunner,
    });

    const allowedTools = this.config.toolShed
      .selectTools(activeTask)
      .map(tool => tool.name);

    const threadManagerConfig = {
      timeout_ms: 300_000,  // 5 minutes — agentic tool loops need more time than single calls
      max_concurrent: 1,
      ...this.config.threadManagerConfig,
    };

    let previousFailureOutput: string | undefined;
    const maxRetries = this.config.maxRetries ?? 3;
    let logs: ExecutionLog[] = [];

    let executor: ReturnType<typeof createOrchestratorExecutor>;
    const threadManager = new ThreadManager(
      threadManagerConfig,
      (task, tools) => executor(task, tools)
    );

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      enhancer.clearInjectedNkEntries();
      executor = createOrchestratorExecutor({
        llmProvider: enhancer,
        testRunner: this.config.testRunner,
        toolShed: this.config.toolShed,
        attemptNumber: attempt,
        previousFailureOutput,
        contextSaturationThreshold: this.config.contextSaturationThreshold ?? 50_000,
      });

      const episode = await threadManager.dispatch(activeTask, allowedTools);
      const log = {
        ...this.convertEpisodeToLog(episode, activeTask),
        attempt,
      };

      logs.push(log);

      if (episode.status === 'success') {
        // Run visual proof hooks if system registered
        if (this.config.visualProofSystem) {
          await this.runVisualProofHooks(activeTask, this.config.visualProofSystem);
        }
        break;
      }
      previousFailureOutput = episode.errors_encountered.join('\n') || undefined;
    }

    const lastLog   = logs[logs.length - 1];
    const succeeded = lastLog?.status === 'success';

    // ── ESCALATE TO CONSORTIUM IF FAILING ────────────────────────────────────

    if (!succeeded && logs.length >= 2) {
      const { approved: consortiumApproved } = await this.config.threePillar.checkAndApprove(
        'consortium_escalation',
        'pipeline'
      );

      if (consortiumApproved) {
        console.log('\n🗳️  Escalating to consortium voter for consensus...');
        try {
          // Sanitize task content to prevent prompt injection into consortium
          const sanitizedTask = activeTask
            .replace(/^(ignore|disregard|forget|system|assistant|user|\[INST\]).*/gim, '[filtered]')
            .slice(0, 2000);

          const consensusPrompt = [
            `Task: ${sanitizedTask}`,
            'The primary model has failed multiple attempts. Provide a clear, concrete implementation plan.',
            'Be specific about what code to write and what approach to take.',
          ].join('\n');

          const voteResult = await this.config.consortiumVoter.vote(consensusPrompt);

          if (voteResult.consensus) {
            console.log(`✅ Consortium reached consensus (confidence: ${(voteResult.confidence * 100).toFixed(0)}%)`);
            this.config.threePillar.recordDecision(
              'consortium',
              `Consensus approach: ${voteResult.consensus.slice(0, 100)}...`,
              `Quorum reached with ${voteResult.cluster_size}/${voteResult.total_votes} models agreeing`,
              voteResult.all_responses.map(r => r.provider),
              'medium'
            );
          } else {
            console.log(`⚠️  Consortium could not reach quorum (confidence: ${(voteResult.confidence * 100).toFixed(0)}%)`);
          }
        } catch (err) {
          console.warn('Consortium voter error (non-fatal):', err instanceof Error ? err.message : String(err));
        }
      } else {
        console.warn('⛔ [3PM] Consortium escalation denied — skipping consensus vote');
      }
    }
    // ── POST-TASK ─────────────────────────────────────────────────────────────

    // Advance SOP to complete
    try {
      const currentStep = this.config.sop.getCurrentStep();
      if (currentStep && currentStep.next_steps.length > 0) {
        const completionStep = currentStep.next_steps.includes('complete')
          ? 'complete'
          : currentStep.next_steps[currentStep.next_steps.length - 1];
        this.config.sop.advance(completionStep);
      }
    } catch { /* SOP may already be at terminal step */ }

    // 6. Record failed attempts to negative knowledge
    const failedLogs = logs.filter(l => l.status === 'failure');
    const nkTarget = this.config.projectNkStore ?? this.negativeKnowledge;
    const newNkEntries: NegativeKnowledgeEntry[] = [];
    if (failedLogs.length > 0) {
      for (const log of failedLogs) {
        const entry = nkTarget.add({
          scenario: activeTask.slice(0, 200),
          attempt:  log.llm_response.slice(0, 300),
          outcome:  log.test_result.output.slice(0, 300),
          solution: succeeded
            ? `Succeeded on attempt ${logs.findIndex(l => l.status === 'success') + 1}`
            : 'No successful solution found in this session',
          tags:     ['auto-recorded', this.config.sopId],
        });
        newNkEntries.push(entry);
      }
      nkTarget.saveToDisk();
      console.log(`\n💾 Recorded ${failedLogs.length} failure(s) to negative knowledge store`);
    }

    // Build vote receipts from injected NK entries
    let voteReceipts: VoteReceipt[] = [];
    const injectedEntries = enhancer.getInjectedNkEntries();
    if (injectedEntries.length > 0) {
      const targetDir = this.config.targetProjectDir ?? path.dirname(this.config.docsDir);
      voteReceipts = createVoteReceipts(injectedEntries, targetDir, succeeded);
    }

    // Promote qualifying NK entries to global store via librarian intake
    if (succeeded && failedLogs.length > 0 && this.config.projectNkStore && this.config.nkPromoter) {
      try {
        const promoted = this.config.nkPromoter.promote(newNkEntries);
        if (promoted > 0) {
          console.log(`📤 Promoted ${promoted} NK entr${promoted === 1 ? 'y' : 'ies'} to global knowledge`);
        }
      } catch (err) {
        console.warn('NK promotion failed (non-fatal):', err instanceof Error ? err.message : String(err));
      }
    }

    // 7. Compress session into memory packet
    const transcript = this.buildTranscript(activeTask, logs);
    let packetPath: string | null = null;

    try {
      const compressionAgent = new CompressionAgent({
        provider:  this.config.routineProvider,
        sessionId: this.sessionId,
      });

      console.log('\n🗜️  Compressing session into memory packet...');
      const packet = await compressionAgent.compress(transcript);

      if (voteReceipts.length > 0) {
        packet.vote_receipts = voteReceipts;
      }

      // 8. Write memory packet to disk
      fs.mkdirSync(this.config.packetsDir, { recursive: true });
      const filename = `${this.sessionId}.json`;
      packetPath = path.join(this.config.packetsDir, filename);
      fs.writeFileSync(packetPath, JSON.stringify(packet, null, 2), 'utf-8');

      // Write to pending_merge/ for merge agent if configured
      if (this.config.pendingMergeDir) {
        try {
          fs.mkdirSync(this.config.pendingMergeDir, { recursive: true });
          const pendingPath = path.join(this.config.pendingMergeDir, `${this.sessionId}.json`);
          fs.writeFileSync(pendingPath, JSON.stringify(packet, null, 2), 'utf-8');
          console.log(`📤 Pending merge packet: ${pendingPath}`);
        } catch (err) {
          console.warn('Pending merge write failed (non-fatal):', err instanceof Error ? err.message : String(err));
        }
      }

      console.log(`📦 Memory packet saved: ${filename}`);
      console.log(`   Compression ratio: ${packet.metadata.compression_ratio.toFixed(1)}:1`);
      console.log(`   Decisions captured: ${packet.decisions.length}`);
      console.log(`   Rejected ideas: ${packet.rejected_ideas.length}`);
      console.log(`   Open threads: ${packet.open_threads.length}`);
    } catch (err) {
      console.warn('Session compression failed (non-fatal):', err instanceof Error ? err.message : String(err));
    }

    // 9. Trigger project orchestrator updates (if project mode is active).
    //    Runs outside the compression block so it fires even if compression failed —
    //    the orchestrator reads from disk and is not dependent on the in-memory packet.
    if (this.config.projectOrchestrator) {
      try {
        if (!succeeded) {
          const lastError = lastLog?.test_result.output?.trim() || 'No error output available';
          await this.config.projectOrchestrator.markCurrentTaskBlocked(
            activeTask,
            `All attempts exhausted: ${lastError.slice(0, 500)}`
          );
        }

        const planning = await this.config.projectOrchestrator.planNextTask();
        if (planning.chosenThread) {
          console.log(`\n🗂️  Next task queued: ${planning.chosenThread.topic}`);
        } else if (planning.openThreads.length > 0) {
          console.log('\n⛔ All remaining threads are blocked — manual intervention required');
        } else {
          console.log('\n✅ All project threads complete');
        }
      } catch (err) {
        console.warn('Project orchestrator error (non-fatal):', err instanceof Error ? err.message : String(err));
      }
    }
    // Log final state via 3PM
    this.config.threePillar.logStateChange(
      'pipeline',
      'task_end',
      'running',
      succeeded ? 'success' : 'failure'
    );

    return {
      status:     succeeded ? 'success' : 'failure',
      attempts:   logs.length,
      logs,
      packetPath,
      sessionId:  this.sessionId,
    };
  }

  private applyApprovalMode(): void {
    const mode = this.config.approvalMode ?? 'strict';
    if (mode === 'dev') {
      this.config.threePillar.setApprovalHandler(async () => true);
    } else if (mode === 'strict') {
      this.config.threePillar.setApprovalHandler(async (request) => {
        console.warn(`⛔ [3PM strict] Action '${request.action}' (risk: ${request.risk_level}) denied by strict mode`);
        return false;
      });
    }
    // 'configurable' — leave the handler as-is on the ThreePillarModel instance
  }

  private async runVisualProofHooks(task: string, vps: VisualProofSystem): Promise<void> {
    const hooks = vps.getHooksByTrigger('post_test');
    if (hooks.length === 0) return;

    console.log(`\n📸 Running ${hooks.length} visual proof hook(s)...`);

    const context: ProofContext = {
      task_description: task,
    };

    const reports = await Promise.allSettled(
      hooks.map(hook => vps.executeHook(hook.name, context))
    );

    const markdown: string[] = [];
    for (const result of reports) {
      if (result.status === 'fulfilled') {
        const report = result.value;
        console.log(`  ✅ ${report.task} — ${report.status} (${report.checks.length} checks)`);
        markdown.push(report.markdown);
      } else {
        console.warn('  ⚠️  Visual proof hook failed (non-fatal):', result.reason instanceof Error ? result.reason.message : String(result.reason));
      }
    }

    if (markdown.length > 0) {
      try {
        const outputPath = this.config.visualProofOutputPath
          ?? path.join(path.dirname(this.config.docsDir), 'demo.md');
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, markdown.join('\n\n---\n\n'), 'utf-8');
        console.log(`  📝 Proof report written: ${outputPath}`);
      } catch (err) {
        console.warn('  ⚠️  Could not write visual proof report (non-fatal):', err instanceof Error ? err.message : String(err));
      }
    }
  }

  private convertEpisodeToLog(episode: Episode, task: string): ExecutionLog {
    return {
      timestamp: episode.timestamp,
      task,
      attempt: 1,
      llm_response: episode.result_summary,
      test_result: {
        passed: episode.artifacts_produced.includes('tests_passed'),
        output: episode.errors_encountered.join('\n'),
        duration_ms: episode.duration_ms,
      },
      status: episode.status === 'success' ? 'success' : 'failure',
    };
  }

  private buildTranscript(task: string, logs: ExecutionLog[]): string {
    const lines: string[] = [
      `# Session Transcript`,
      `Session: ${this.sessionId}`,
      `Task: ${task}`,
      '',
    ];

    for (const log of logs) {
      lines.push(`## Attempt ${log.attempt} [${log.status}] @ ${log.timestamp}`);
      if (log.llm_response) {
        lines.push('### LLM Response');
        lines.push(log.llm_response.slice(0, 1000));
      }
      lines.push('### Test Result');
      lines.push(`Passed: ${log.test_result.passed}`);
      if (log.test_result.output) {
        lines.push(log.test_result.output.slice(0, 500));
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}

