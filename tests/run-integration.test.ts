import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TaskIntake } from '../src/pipeline/task-intake';
import { ContextDiscovery } from '../src/pipeline/context-discovery';

describe('Task Intake Integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eba-integ-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('full intake flow: peek -> pipeline uses content -> markProcessed', () => {
    const intakeDir = path.join(tmpDir, 'task-intake');
    fs.mkdirSync(intakeDir);
    fs.writeFileSync(path.join(intakeDir, 'fix-auth.md'),
      '---\npriority: 15\n---\n# Fix auth middleware\nTokens rejected after OAuth2 migration');

    const intake = new TaskIntake(intakeDir);
    const task = intake.peek();

    expect(task).not.toBeNull();
    expect(task!.content).toContain('Fix auth middleware');
    expect(task!.priority).toBe(15);

    intake.markProcessed(task!);

    expect(fs.existsSync(path.join(intakeDir, 'processed', 'fix-auth.md'))).toBe(true);
    expect(intake.peek()).toBeNull();
  });

  it('context discovery reads .eba.json test_command', () => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# Test Project');
    fs.writeFileSync(path.join(tmpDir, '.eba.json'),
      JSON.stringify({ test_command: 'npm run e2e', project_name: 'test-proj' }));

    const config = JSON.parse(fs.readFileSync(
      path.join(tmpDir, '.eba.json'), 'utf-8'));
    expect(config.test_command).toBe('npm run e2e');

    const ctx = new ContextDiscovery(tmpDir, '/nonexistent/SYSTEM.md').discover();
    expect(ctx.content).toContain('Test Project');
  });

  it('priority chain: intake beats ACTIVE_TASK.md', () => {
    const intakeDir = path.join(tmpDir, 'task-intake');
    fs.mkdirSync(intakeDir);
    fs.writeFileSync(path.join(intakeDir, 'urgent.md'),
      '---\npriority: 20\n---\nUrgent intake task');
    fs.writeFileSync(path.join(tmpDir, 'ACTIVE_TASK.md'),
      '# Old task from orchestrator');

    const intake = new TaskIntake(intakeDir);
    const task = intake.peek();

    expect(task).not.toBeNull();
    expect(task!.content).toBe('Urgent intake task');
  });
});
