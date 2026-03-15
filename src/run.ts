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
 *   TEST_COMMAND        — shell command used to verify work (default: "npm test")
 *   PRIMARY_MODEL       — claude | gemini | openai (default: claude)
 */

import * as path from 'path';
import * as fs   from 'fs';
import 'dotenv/config';

import { ModelRouter }           from './providers/model-router';
import { BlueprintOrchestrator } from './phase1/orchestrator';
import { NegativeKnowledgeStore } from './phase1/negative-knowledge';
import { createDefaultToolShed } from './phase2/tool-shed';
import { SOPEngine, createRefactoringSOP } from './phase2/sop';
import { ThreePillarModel }      from './phase3/three-pillar-model';
import { ShellTestRunner }       from './utils/shell-test-runner';

const ROOT_DIR      = path.resolve(__dirname, '..');
const DOCS_DIR      = path.join(ROOT_DIR, 'docs');
const LOGS_DIR      = path.join(DOCS_DIR, 'logs');
const SOLUTIONS_DIR = path.join(DOCS_DIR, 'solutions');

async function main() {
  console.log('\n🚀 Episodic Blueprint Architecture — starting up\n');

  // --- Validate env ---
  const missing = ['ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY'].filter(
    k => !process.env[k]
  );
  if (missing.length > 0) {
    console.error(`❌ Missing environment variables: ${missing.join(', ')}`);
    console.error('   Copy .env.example to .env and fill in your keys.');
    process.exit(1);
  }

  // --- Config from env ---
  const testCommand  = process.env.TEST_COMMAND  ?? 'npm test';
  const primaryModel = (process.env.PRIMARY_MODEL ?? 'claude') as 'claude' | 'gemini' | 'openai';

  // --- Bootstrap components ---
  const router = new ModelRouter({ primary: primaryModel, enableConsortium: true });

  const negativeKnowledge = new NegativeKnowledgeStore(SOLUTIONS_DIR);
  negativeKnowledge.loadFromDisk();
  console.log(`📚 Loaded ${negativeKnowledge.getAll().length} negative knowledge entries`);

  createDefaultToolShed();

  const sop = new SOPEngine();
  sop.register(createRefactoringSOP());

  const threePillar = new ThreePillarModel(async (request) => {
    console.log(`\n⚠️  Approval required for: ${request.action} (risk: ${request.risk_level})`);
    console.log('   Auto-approving in development mode. Set a real handler for production.');
    return true;
  });

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

  // --- Run orchestrator ---
  const orchestrator = new BlueprintOrchestrator({
    docsDir:                    DOCS_DIR,
    logsDir:                    LOGS_DIR,
    maxRetries:                 3,
    contextSaturationThreshold: 50_000,
    llmProvider:                router.standard,
    testRunner,
  });

  const activeTask = orchestrator.readActiveTask();
  console.log(`📋 Active task: ${activeTask?.split('\n')[2] ?? '(see ACTIVE_TASK.md)'}`);
  console.log(`🤖 Primary model: ${primaryModel}`);
  console.log(`🧪 Test command:  ${testCommand}`);
  console.log(`🗳️  Consortium:   Claude Opus + Gemini Pro + GPT-4o\n`);

  try {
    const logs = await orchestrator.executeTask();
    const last = logs[logs.length - 1];

    console.log('');
    if (last?.status === 'success') {
      console.log(`✅ Task completed in ${logs.length} attempt(s)`);
    } else {
      console.log(`⚠️  Task ended with status: ${last?.status} after ${logs.length} attempt(s)`);
      if (last?.test_result?.output) {
        console.log('\n📋 Last test output:');
        console.log(last.test_result.output.slice(0, 1000));
      }
    }

    console.log(`📁 Logs written to: ${LOGS_DIR}`);
  } catch (err) {
    console.error('\n❌ Orchestrator error:', err);
    process.exit(1);
  }
}

main();
