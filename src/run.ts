/**
 * EBA Entry Point
 * Boots the system using environment variables for API keys.
 * Reads the active task from docs/ACTIVE_TASK.md and executes it.
 *
 * Usage:
 *   cp .env.example .env       # add your API keys
 *   npx ts-node src/run.ts
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY   — required
 *   GOOGLE_API_KEY      — required
 *   OPENAI_API_KEY      — required
 *   OPENROUTER_API_KEY  — required only when PRIMARY_MODEL=openrouter
 *   TEST_COMMAND        — shell command used to verify work (default: "npm test")
 *   PRIMARY_MODEL       — claude | gemini | openai | openrouter (default: claude)
 */

import * as path from 'path';
import * as fs   from 'fs';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { ModelRouter } from './providers/model-router';
import { startBenchmarkScheduler } from './scheduler';
import { NegativeKnowledgeStore } from './phase1/negative-knowledge';
import { createDefaultToolShed } from './phase2/tool-shed';
import { SOPEngine, SOPDefinition, createRefactoringSOP } from './phase2/sop';
import {
  createBugFixSOP,
  createFeatureSOP,
  createCodeReviewSOP,
  createDependencyUpgradeSOP,
  createDeploymentSOP,
  createDatabaseMigrationSOP,
  createDocumentationSOP,
  createSecurityAuditSOP,
  createPerformanceOptimizationSOP,
  createInfrastructureProbeSOP,
} from './phase2/sop-library';
import { ThreePillarModel } from './phase3/three-pillar-model';
import { EBAPipeline } from './pipeline/eba-pipeline';
import { ShellTestRunner } from './utils/shell-test-runner';
import { ProjectOrchestrator } from './pipeline/project-orchestrator';
import { TaskQueue } from './pipeline/task-queue';
import { MergeAgent } from './pipeline/merge-agent';

const ROOT_DIR      = path.resolve(__dirname, '..');
const DOCS_DIR      = path.join(ROOT_DIR, 'docs');
const LOGS_DIR      = path.join(DOCS_DIR, 'logs');
const PACKETS_DIR   = path.join(DOCS_DIR, 'memory-packets');
const SOLUTIONS_DIR = path.join(DOCS_DIR, 'solutions');
const PENDING_MERGE_DIR = path.join(DOCS_DIR, 'pending_merge');
const QUEUE_DB_PATH = path.join(ROOT_DIR, 'data', 'task-queue.db');

function selectSOP(taskText: string, sopEngine: SOPEngine): SOPDefinition {
  const refactoringSop = createRefactoringSOP();
  const bugFixSop = createBugFixSOP();
  const featureSop = createFeatureSOP();
  const codeReviewSop = createCodeReviewSOP();
  const dependencyUpgradeSop = createDependencyUpgradeSOP();
  const deploymentSop = createDeploymentSOP();
  const databaseMigrationSop = createDatabaseMigrationSOP();
  const documentationSop = createDocumentationSOP();
  const securityAuditSop = createSecurityAuditSOP();
  const performanceOptimizationSop = createPerformanceOptimizationSOP();
  const infrastructureProbeSop = createInfrastructureProbeSOP();

  const allSops = [
    refactoringSop,
    bugFixSop,
    featureSop,
    codeReviewSop,
    dependencyUpgradeSop,
    deploymentSop,
    databaseMigrationSop,
    documentationSop,
    securityAuditSop,
    performanceOptimizationSop,
    infrastructureProbeSop,
  ];

  for (const sop of allSops) {
    sopEngine.register(sop);
  }

  const normalizedTaskText = taskText.toLowerCase();

  const keywordMappings: Array<{ keywords: string[]; sop: SOPDefinition }> = [
    {
      keywords: ['bug', 'fix', 'broken', 'error', 'crash', 'failing', 'regression'],
      sop: bugFixSop,
    },
    {
      keywords: ['feature', 'implement', 'build', 'add', 'new', 'create'],
      sop: featureSop,
    },
    {
      keywords: ['audit', 'organize', 'organis', 'infrastructure', 'directory', 'drive', 'filesystem', 'system admin', 'sysadmin', 'probe', 'survey', 'inventory', 'mapping', 'migration plan', 'reorgani'],
      sop: infrastructureProbeSop,
    },
    {
      keywords: ['review', 'inspect', 'check quality'],
      sop: codeReviewSop,
    },
    {
      keywords: ['refactor', 'clean', 'restructure', 'rename'],
      sop: refactoringSop,
    },
    {
      keywords: ['dependency', 'upgrade', 'update package', 'npm update'],
      sop: dependencyUpgradeSop,
    },
    {
      keywords: ['deploy', 'release', 'ship', 'rollout'],
      sop: deploymentSop,
    },
    {
      keywords: ['document', 'readme', 'docs', 'guide'],
      sop: documentationSop,
    },
    {
      keywords: ['security', 'vulnerability', 'injection', 'sanitize'],
      sop: securityAuditSop,
    },
    {
      keywords: ['performance', 'optimize', 'slow', 'latency', 'throughput'],
      sop: performanceOptimizationSop,
    },
  ];

  const matched = keywordMappings.find(({ keywords }) =>
    keywords.some(keyword => normalizedTaskText.includes(keyword)),
  );

  return matched?.sop ?? refactoringSop;
}

function detectTaskType(taskContent: string): 'coding' | 'probe' {
  const probeKeywords = [
    'audit', 'organize', 'organis', 'infrastructure', 'directory', 'drive',
    'filesystem', 'system admin', 'sysadmin', 'probe', 'survey', 'inventory',
    'mapping', 'migration plan', 'reorgani', 'validation_report', 'pitfalls'
  ];
  const lower = taskContent.toLowerCase();
  return probeKeywords.some(k => lower.includes(k)) ? 'probe' : 'coding';
}
async function main() {
  console.log('\n🚀 Episodic Blueprint Architecture — starting up\n');

  // --- Config from env ---
  const envTestCommand = process.env.TEST_COMMAND ?? 'npm test';

  // Allowlist: only permit safe characters for a shell test command from env
  const SAFE_COMMAND = /^[a-zA-Z0-9 _.\-\/=]+$/;
  if (!SAFE_COMMAND.test(envTestCommand)) {
    console.error(`❌ TEST_COMMAND contains disallowed characters: "${envTestCommand}"`);
    console.error('   Only alphanumeric characters, spaces, hyphens, underscores, dots, slashes and = are allowed.');
    console.error('   Example: "npm test" or "jest --runInBand"');
    process.exit(1);
  }
  const primaryModel = (process.env.PRIMARY_MODEL ?? 'claude') as 'claude' | 'gemini' | 'openai' | 'openrouter';

  // --- Validate env ---
  const requiredKeys = ['ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY'];
  if (primaryModel === 'openrouter') {
    requiredKeys.push('OPENROUTER_API_KEY');
  }

  const missing = requiredKeys.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`❌ Missing environment variables: ${missing.join(', ')}`);
    console.error('   Copy .env.example to .env and fill in your keys.');
    process.exit(1);
  }

  // --- Bootstrap components ---
  const router = new ModelRouter({ primary: primaryModel, enableConsortium: true });
  const schedulerHandle = startBenchmarkScheduler();
  process.on('exit', () => clearInterval(schedulerHandle));
  process.on('SIGINT', () => { clearInterval(schedulerHandle); process.exit(0); });
  process.on('SIGTERM', () => { clearInterval(schedulerHandle); process.exit(0); });
  const consortiumVoter = router.getConsortiumVoter();
  const negativeKnowledge = new NegativeKnowledgeStore(SOLUTIONS_DIR);
  negativeKnowledge.loadFromDisk();
  console.log(`📚 Loaded ${negativeKnowledge.getAll().length} negative knowledge entries`);

  const toolShed = createDefaultToolShed(ROOT_DIR);

  const sop = new SOPEngine();
  const autoApproveCritical = process.env.EBA_AUTO_APPROVE_CRITICAL === 'true';

  const threePillar = new ThreePillarModel(async (request) => {
    console.log(`\n⚠️  Approval required for: ${request.action} (risk: ${request.risk_level})`);

    if (request.risk_level === 'critical') {
      if (!autoApproveCritical) {
        console.error('   Critical-risk actions are blocked by default. Set EBA_AUTO_APPROVE_CRITICAL=true in .env.local to allow them.');
        return false;
      }

      console.warn('   Auto-approving critical-risk action because EBA_AUTO_APPROVE_CRITICAL=true.');
      return true;
    }

    console.log('   Auto-approving in development mode. Set a real handler for production.');
    return true;
  });

  // ModelRouter has `routine` (not `fast`) for cheap/fast tasks.
  const routineProvider = router.routine ?? router.standard;

  // --- Boot planning step: read PROJECT.md + latest memory packet, select next task ---
  const projectOrchestrator = new ProjectOrchestrator({
    docsDir:    DOCS_DIR,
    packetsDir: PACKETS_DIR,
    provider:   routineProvider,
  });
  const planning = await projectOrchestrator.planNextTask();
  if (planning.chosenThread) {
    console.log(`📋 Project mode: selected "${planning.chosenThread.topic}" from open threads`);
  } else {
    console.log('📋 Manual mode: using existing ACTIVE_TASK.md');
  }

  // --- Multi-agent mode (opt-in via EBA_MULTI_AGENT=true) ---
  const multiAgentMode = process.env.EBA_MULTI_AGENT === 'true';

  if (multiAgentMode) {
    fs.mkdirSync(path.dirname(QUEUE_DB_PATH), { recursive: true });
    const agentId = `agent_${process.pid}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const queue = new TaskQueue(QUEUE_DB_PATH);
    const mergeAgentInstance = new MergeAgent({
      pendingDir: PENDING_MERGE_DIR,
      packetsDir: PACKETS_DIR,
      routineProvider: routineProvider,
    });

    console.log(`🤖 Multi-agent mode: ${agentId}`);

    // Release stale tasks from crashed workers
    const stale = queue.staleCheck(300_000);
    for (const taskId of stale) {
      queue.release(taskId);
      console.log(`♻️  Released stale task: ${taskId}`);
    }

    // Seed queue from open threads if queue is empty
    const stats = queue.peek();
    if (stats.pending === 0 && stats.claimed === 0) {
      const queuePlanning = await projectOrchestrator.planNextTask();
      // If there are actionable threads, we'd enqueue them here
      // (Task 7 adds enqueueFromThreads — for now just log)
      if (queuePlanning.openThreads.length > 0) {
        console.log(`📋 ${queuePlanning.openThreads.length} open thread(s) available for future queue seeding`);
      }
    }

    const claimed = queue.claim(agentId);
    if (!claimed) {
      console.log('📋 No pending tasks in queue');
      queue.close();
      return;
    }

    console.log(`📋 Claimed task: ${claimed.id} (priority: ${claimed.priority})`);

    // Write isolated task file
    const agentTaskPath = path.join(DOCS_DIR, `ACTIVE_TASK_${agentId}.md`);
    fs.writeFileSync(agentTaskPath, claimed.task, 'utf-8');

    const selectedSop = selectSOP(claimed.task, sop);
    const taskType = detectTaskType(claimed.task);
    const testCommand = taskType === 'probe'
      ? 'test -f docs/validation_report.md || test -f docs/pitfalls.md'
      : envTestCommand;

    const testRunner = new ShellTestRunner({
      command: testCommand,
      cwd: ROOT_DIR,
      timeoutMs: 120_000,
    });

    const pipeline = new EBAPipeline({
      docsDir: DOCS_DIR,
      logsDir: LOGS_DIR,
      packetsDir: PACKETS_DIR,
      solutionsDir: SOLUTIONS_DIR,
      primaryProvider: router.standard,
      routineProvider,
      consortiumVoter,
      sop,
      sopId: selectedSop.id,
      toolShed,
      threePillar,
      testRunner,
      approvalMode: 'dev',
      activeTaskPath: agentTaskPath,
      pendingMergeDir: PENDING_MERGE_DIR,
    });

    try {
      const result = await pipeline.run();
      if (result.status === 'success') {
        queue.complete(claimed.id, {
          episodeSummary: `Completed in ${result.attempts} attempt(s)`,
          artifacts: [],
          status: 'success',
        });
        // Clean desk
        if (fs.existsSync(agentTaskPath)) fs.unlinkSync(agentTaskPath);
        console.log(`✅ Task ${claimed.id} completed`);
      } else {
        queue.fail(claimed.id, `Failed after ${result.attempts} attempt(s)`);
        // Leave agentTaskPath for forensics
        console.log(`⚠️  Task ${claimed.id} failed`);
      }
    } catch (err) {
      queue.fail(claimed.id, err instanceof Error ? err.message : String(err));
      console.error(`❌ Task ${claimed.id} error:`, err instanceof Error ? err.message : String(err));
    }

    // Always sweep pending merges and close queue
    try {
      const mergeResult = await mergeAgentInstance.sweep();
      if (mergeResult.merged) {
        console.log(`🔀 Merged ${mergeResult.packetCount} packet(s) → ${mergeResult.outputPath}`);
      }
    } catch (err) {
      console.warn('Merge sweep failed (non-fatal):', err instanceof Error ? err.message : String(err));
    } finally {
      queue.close();
    }
    return;
  }

  // --- Legacy single-agent mode below (UNCHANGED) ---

  // --- Validate active task ---
  const taskFile = path.join(DOCS_DIR, 'ACTIVE_TASK.md');
  if (!fs.existsSync(taskFile)) {
    console.error(`❌ No ACTIVE_TASK.md found at ${taskFile}`);
    process.exit(1);
  }
  const taskText = fs.readFileSync(taskFile, 'utf-8');
  const taskType = detectTaskType(taskText);
  const selectedSop = selectSOP(taskText, sop);
  const testCommand = taskType === 'probe'
    ? 'test -f docs/validation_report.md || test -f docs/pitfalls.md'
    : envTestCommand;

  // --- Wire real test runner ---
  const testRunner = new ShellTestRunner({
    command:   testCommand,
    cwd:       ROOT_DIR,
    timeoutMs: 120_000,
  });

  const pipeline = new EBAPipeline({
    docsDir: DOCS_DIR,
    logsDir: LOGS_DIR,
    packetsDir: PACKETS_DIR,
    solutionsDir: SOLUTIONS_DIR,
    primaryProvider: router.standard,
    routineProvider,
    consortiumVoter,
    sop,
    sopId: selectedSop.id,
    toolShed,
    threePillar,
    testRunner,
    projectOrchestrator,
    approvalMode: 'dev',
  });

  console.log(`📋 Active task: ${(taskText.split('\n')[2] ?? '(see ACTIVE_TASK.md)').trim()}`);
  console.log(`🤖 Primary model: ${primaryModel}`);
  console.log(`🧪 Test command:  ${testCommand}`);
  console.log('🗳️  Consortium:   Claude Opus + Gemini Pro + GPT-4o');
  console.log(`📋 SOP:           ${selectedSop.name} (${selectedSop.id})\n`);

  try {
    const result = await pipeline.run();

    console.log('');
    if (result.status === 'success') {
      console.log(`✅ Task completed in ${result.attempts} attempt(s)`);
    } else {
      console.log(`⚠️  Task ended with status: ${result.status} after ${result.attempts} attempt(s)`);
      const last = result.logs[result.logs.length - 1];
      if (last?.test_result?.output) {
        console.log('\n📋 Last test output:');
        console.log(last.test_result.output.slice(0, 1000));
      }
    }

    console.log(`📁 Logs written to: ${LOGS_DIR}`);
    if (result.packetPath) {
      console.log(`📦 Memory packet:   ${result.packetPath}`);
    }
    console.log(`🆔 Session id:      ${result.sessionId}`);
  } catch (err) {
    console.error('\n❌ Pipeline error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
