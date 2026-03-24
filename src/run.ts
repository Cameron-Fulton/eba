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
import { createDefaultToolShed, ToolShedConfig } from './phase2/tool-shed';
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
import { TaskIntake } from './pipeline/task-intake';
import { ContextDiscovery } from './pipeline/context-discovery';
import { NKPromoter } from './pipeline/nk-promoter';

/** Allowlist: only permit safe characters for shell test commands */
const SAFE_COMMAND = /^[a-zA-Z0-9 _.\-\/=]+$/;

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
  console.log(`📚 Loaded ${negativeKnowledge.getAll().length} global negative knowledge entries`);

  const toolShed = createDefaultToolShed({ projectRoot: ROOT_DIR });

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

  // --- Boot planning step ---
  const projectOrchestrator = new ProjectOrchestrator({
    docsDir:    DOCS_DIR,
    packetsDir: PACKETS_DIR,
    provider:   routineProvider,
  });

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
      const seeded = projectOrchestrator.enqueueFromThreads(queue);
      if (seeded > 0) {
        console.log(`📥 Seeded ${seeded} task(s) from open threads`);
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

  // --- Single-agent mode ---

  const INTAKE_DIR = path.join(DOCS_DIR, 'task-intake');
  let taskText: string;
  let taskSource: string;
  let targetProjectDir: string = ROOT_DIR;
  let intakeRef: { intake: TaskIntake; task: { content: string; priority: number; sourcePath: string } } | null = null;

  // Priority 1: CLI argument
  const cliTask = process.argv[2];
  if (cliTask && cliTask.trim().length > 0 && !cliTask.startsWith('-')) {
    taskText = `# Active Task\n\n## Task\n${cliTask.trim()}`;
    taskSource = 'CLI argument';
    // When invoked via CLI, target project is cwd (if different from EBA)
    const cwd = process.cwd();
    if (path.resolve(cwd) !== path.resolve(ROOT_DIR)) {
      targetProjectDir = cwd;
    }
  }
  // Priority 2: Intake drop zone
  else {
    const intake = new TaskIntake(INTAKE_DIR);
    const intakeTask = intake.peek();

    if (intakeTask) {
      taskText = `# Active Task\n\n## Task\n${intakeTask.content}`;
      taskSource = `intake file (priority: ${intakeTask.priority})`;
      intakeRef = { intake, task: intakeTask };
    }
    // Priority 3: Orchestrator (memory packet threads)
    else {
      const planning = await projectOrchestrator.planNextTask();
      if (planning.chosenThread) {
        console.log(`📋 Project mode: selected "${planning.chosenThread.topic}" from open threads`);
      } else {
        console.log('📋 Fallback: using existing ACTIVE_TASK.md');
      }

      // Priority 4: Whatever is in ACTIVE_TASK.md
      const taskFile = path.join(DOCS_DIR, 'ACTIVE_TASK.md');
      if (!fs.existsSync(taskFile)) {
        console.error('❌ No task found — no CLI arg, no intake files, no ACTIVE_TASK.md');
        process.exit(1);
      }
      taskText = fs.readFileSync(taskFile, 'utf-8');
      taskSource = 'ACTIVE_TASK.md';
    }
  }

  // Write resolved task to ACTIVE_TASK.md (for intake/CLI paths)
  if (taskSource !== 'ACTIVE_TASK.md') {
    const taskFile = path.join(DOCS_DIR, 'ACTIVE_TASK.md');
    fs.writeFileSync(taskFile, taskText, 'utf-8');
  }

  // Discover project context
  const contextDiscovery = new ContextDiscovery(targetProjectDir);
  const projectContext = contextDiscovery.discover();
  if (projectContext.sources.length > 0) {
    console.log(`📖 Project context: ${projectContext.sources.length} file(s) loaded`);
    if (projectContext.truncated) {
      console.warn('⚠️  Project context was truncated to 50,000 characters');
    }
  }

  // Use ebaConfig from context discovery (already parsed .eba.json)
  const ebaConfig = projectContext.ebaConfig;
  const ebaTestCommand = ebaConfig?.test_command;
  if (ebaTestCommand && !SAFE_COMMAND.test(ebaTestCommand)) {
    console.error(`❌ .eba.json test_command contains disallowed characters: "${ebaTestCommand}"`);
    console.error('   Only alphanumeric characters, spaces, hyphens, underscores, dots, slashes and = are allowed.');
    process.exit(1);
  }

  // Build target-aware tool-shed
  const toolShedConfig: ToolShedConfig = {
    projectRoot: targetProjectDir,
    testCommand: ebaTestCommand ?? envTestCommand,
    allowedPrefixes: ebaConfig?.allowed_commands,
  };
  const targetToolShed = createDefaultToolShed(toolShedConfig);

  // Set up artifact directories for external projects
  const isExternalProject = path.resolve(targetProjectDir) !== path.resolve(ROOT_DIR);
  let solutionsDir = SOLUTIONS_DIR;
  let packetsDir = PACKETS_DIR;
  let logsDir = LOGS_DIR;

  if (isExternalProject) {
    const ebaDir = path.join(targetProjectDir, '.eba');
    solutionsDir = path.join(ebaDir, 'solutions');
    packetsDir = path.join(ebaDir, 'memory-packets');
    logsDir = path.join(ebaDir, 'logs');

    // Create .eba/ structure (idempotent — recursive:true is a no-op if exists)
    const ebaExisted = fs.existsSync(ebaDir);
    fs.mkdirSync(solutionsDir, { recursive: true });
    fs.mkdirSync(packetsDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });
    if (!ebaExisted) {
      console.log(`📁 Creating .eba/ in ${targetProjectDir} for EBA artifacts`);
      // Create .gitignore if target project has .git/
      if (fs.existsSync(path.join(targetProjectDir, '.git'))) {
        fs.writeFileSync(path.join(ebaDir, '.gitignore'), [
          '# EBA session artifacts',
          'logs/',
          'memory-packets/',
          '# Solutions are committed — curated project-specific knowledge',
          '',
        ].join('\n'));
      }
    }
  }

  // Set up dual NK stores (project-specific NK for external projects)
  let projectNkStore: NegativeKnowledgeStore | undefined;
  if (isExternalProject) {
    fs.mkdirSync(solutionsDir, { recursive: true });
    projectNkStore = new NegativeKnowledgeStore(solutionsDir);
    projectNkStore.loadFromDisk();
    console.log(`📚 Loaded ${projectNkStore.getAll().length} project negative knowledge entries`);
  }

  // Create NK promoter for external projects (when librarian intake exists)
  let nkPromoter: NKPromoter | undefined;
  if (isExternalProject) {
    const intakeDir = process.env.LIBRARIAN_INTAKE_DIR ?? 'D:\\_system\\librarian\\intake';
    if (fs.existsSync(intakeDir)) {
      nkPromoter = new NKPromoter({
        intakeDir,
        projectName: ebaConfig?.project_name ?? path.basename(targetProjectDir),
        projectRoot: targetProjectDir,
      });
      console.log('📤 NK promotion enabled (librarian intake available)');
    }
  }

  const taskType = detectTaskType(taskText);
  const selectedSop = selectSOP(taskText, sop);
  const testCommand = ebaTestCommand
    ?? (taskType === 'probe'
      ? 'test -f docs/validation_report.md || test -f docs/pitfalls.md'
      : envTestCommand);

  const testRunner = new ShellTestRunner({
    command: testCommand,
    cwd: targetProjectDir,
    timeoutMs: 120_000,
  });

  const pipeline = new EBAPipeline({
    docsDir: DOCS_DIR,
    logsDir,
    packetsDir,
    solutionsDir,
    primaryProvider: router.standard,
    routineProvider,
    consortiumVoter,
    sop,
    sopId: selectedSop.id,
    toolShed: targetToolShed,
    threePillar,
    testRunner,
    projectOrchestrator,
    approvalMode: 'dev',
    projectContext: projectContext.content || undefined,
    targetProjectDir: targetProjectDir !== ROOT_DIR ? targetProjectDir : undefined,
    projectNkStore,
    nkPromoter,
  });

  console.log(`📋 Task source: ${taskSource}`);
  console.log(`📋 Active task: ${(taskText.split('\n').find(l => l.trim().length > 0 && !l.startsWith('#')) ?? '(see ACTIVE_TASK.md)').trim()}`);
  console.log(`🤖 Primary model: ${primaryModel}`);
  console.log(`🧪 Test command:  ${testCommand}`);
  console.log('🗳️  Consortium:   Claude Opus + Gemini Pro + GPT-4o');
  console.log(`📋 SOP:           ${selectedSop.name} (${selectedSop.id})\n`);

  let result: Awaited<ReturnType<typeof pipeline.run>> | undefined;
  try {
    result = await pipeline.run();

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

  // After pipeline completes — move intake file
  if (intakeRef && result) {
    if (result.status === 'success') {
      intakeRef.intake.markProcessed(intakeRef.task);
    } else {
      intakeRef.intake.markFailed(intakeRef.task);
    }
  }
}

main();
