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

import { LLMProvider }              from '../phase1/orchestrator';
import { BlueprintOrchestrator, OrchestratorConfig, ExecutionLog } from '../phase1/orchestrator';
import { NegativeKnowledgeStore }   from '../phase1/negative-knowledge';
import { CompressionAgent }         from '../phase1/compression-agent';
import { ToolShed }                 from '../phase2/tool-shed';
import { SOPEngine }                from '../phase2/sop';
import { ConsortiumVoter }          from '../phase3/consortium-voter';
import { ThreePillarModel }         from '../phase3/three-pillar-model';
import { PromptEnhancer }           from './prompt-enhancer';

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
    this.sessionId = config.sessionId ?? `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
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

    // 3. Wrap primary provider with prompt enhancer
    const enhancer = new PromptEnhancer({
      provider:          this.config.primaryProvider,
      negativeKnowledge: this.negativeKnowledge,
      sop:               this.config.sop,
      toolShed:          this.config.toolShed,
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

    const activeTask = orchestrator.readActiveTask() ?? '';
    let logs: ExecutionLog[] = [];

    try {
      logs = await orchestrator.executeTask();
    } catch (err) {
      console.error('Orchestrator error:', err);
    }

    const lastLog   = logs[logs.length - 1];
    const succeeded = lastLog?.status === 'success';

    // ── ESCALATE TO CONSORTIUM IF FAILING ────────────────────────────────────

    if (!succeeded && logs.length >= 2) {
      console.log('\n🗳️  Escalating to consortium voter for consensus...');
      try {
        const consensusPrompt = [
          `Task: ${activeTask}`,
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
        console.warn('Consortium voter error (non-fatal):', err);
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
    if (failedLogs.length > 0) {
      for (const log of failedLogs) {
        this.negativeKnowledge.add({
          scenario: activeTask.slice(0, 200),
          attempt:  log.llm_response.slice(0, 300),
          outcome:  log.test_result.output.slice(0, 300),
          solution: succeeded
            ? `Succeeded on attempt ${logs.findIndex(l => l.status === 'success') + 1}`
            : 'No successful solution found in this session',
          tags:     ['auto-recorded', this.config.sopId],
        });
      }
      this.negativeKnowledge.saveToDisk();
      console.log(`\n💾 Recorded ${failedLogs.length} failure(s) to negative knowledge store`);
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

      // 8. Write memory packet to disk
      fs.mkdirSync(this.config.packetsDir, { recursive: true });
      const filename = `${this.sessionId}.json`;
      packetPath = path.join(this.config.packetsDir, filename);
      fs.writeFileSync(packetPath, JSON.stringify(packet, null, 2), 'utf-8');

      console.log(`📦 Memory packet saved: ${filename}`);
      console.log(`   Compression ratio: ${packet.metadata.compression_ratio.toFixed(1)}:1`);
      console.log(`   Decisions captured: ${packet.decisions.length}`);
      console.log(`   Rejected ideas: ${packet.rejected_ideas.length}`);
    } catch (err) {
      console.warn('Session compression failed (non-fatal):', err);
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

