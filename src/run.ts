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
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { ModelRouter } from './providers/model-router';
import { startBenchmarkScheduler } from './scheduler';
import { NegativeKnowledgeStore } from './phase1/negative-knowledge';
import { createDefaultToolShed } from './phase2/tool-shed';
import { SOPEngine, createRefactoringSOP } from './phase2/sop';
import { ThreePillarModel } from './phase3/three-pillar-model';
import { EBAPipeline } from './pipeline/eba-pipeline';
import { ShellTestRunner } from './utils/shell-test-runner';
import { ProjectOrchestrator } from './pipeline/project-orchestrator';

const ROOT_DIR      = path.resolve(__dirname, '..');
const DOCS_DIR      = path.join(ROOT_DIR, 'docs');
const LOGS_DIR      = path.join(DOCS_DIR, 'logs');
const PACKETS_DIR   = path.join(DOCS_DIR, 'memory-packets');
const SOLUTIONS_DIR = path.join(DOCS_DIR, 'solutions');

async function main() {
  console.log('\n🚀 Episodic Blueprint Architecture — starting up\n');

  // --- Config from env ---
  const testCommand  = process.env.TEST_COMMAND ?? 'npm test';

const SHELL_METACHARACTERS = /[;&|$`\<>]/;
if (SHELL_METACHARACTERS.test(testCommand)) {
  console.error(`❌ TEST_COMMAND contains disallowed shell metacharacters: "${testCommand}"`);
  console.error('   Only safe commands are allowed (e.g. "npm test", "jest --runInBand").');
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

  const toolShed = createDefaultToolShed();

  const sop = new SOPEngine();
  const refactoringSop = createRefactoringSOP();
  sop.register(refactoringSop);

  const threePillar = new ThreePillarModel(async (request) => {
    console.log(`\n⚠️  Approval required for: ${request.action} (risk: ${request.risk_level})`);
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

  // --- Validate active task ---
  const taskFile = path.join(DOCS_DIR, 'ACTIVE_TASK.md');
  if (!fs.existsSync(taskFile)) {
    console.error(`❌ No ACTIVE_TASK.md found at ${taskFile}`);
    process.exit(1);
  }

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
    sopId: refactoringSop.id,
    toolShed,
    threePillar,
    testRunner,
    projectOrchestrator,
    approvalMode: 'dev',
  });

  console.log(`📋 Active task: ${(fs.readFileSync(taskFile, 'utf-8').split('\n')[2] ?? '(see ACTIVE_TASK.md)').trim()}`);
  console.log(`🤖 Primary model: ${primaryModel}`);
  console.log(`🧪 Test command:  ${testCommand}`);
  console.log('🗳️  Consortium:   Claude Opus + Gemini Pro + GPT-4o');
  console.log(`📋 SOP:           ${refactoringSop.name} (${refactoringSop.id})\n`);

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
    console.error('\n❌ Pipeline error:', err);
    process.exit(1);
  }
}

main();
