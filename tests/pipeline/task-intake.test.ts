// tests/pipeline/task-intake.test.ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TaskIntake } from '../../src/pipeline/task-intake';

describe('TaskIntake', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eba-intake-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when intake dir is empty', () => {
    const intake = new TaskIntake(tmpDir);
    expect(intake.peek()).toBeNull();
  });

  it('returns null when intake dir does not exist', () => {
    const intake = new TaskIntake(path.join(tmpDir, 'nonexistent'));
    expect(intake.peek()).toBeNull();
  });

  it('picks highest priority task', () => {
    fs.writeFileSync(path.join(tmpDir, 'low.md'), '---\npriority: 1\n---\nLow priority task');
    fs.writeFileSync(path.join(tmpDir, 'high.md'), '---\npriority: 20\n---\nHigh priority task');
    const intake = new TaskIntake(tmpDir);
    const task = intake.peek();
    expect(task).not.toBeNull();
    expect(task!.content).toBe('High priority task');
    expect(task!.priority).toBe(20);
  });

  it('defaults priority to 10 when no frontmatter', () => {
    fs.writeFileSync(path.join(tmpDir, 'plain.md'), '# Just a task\nDo the thing');
    const intake = new TaskIntake(tmpDir);
    const task = intake.peek();
    expect(task).not.toBeNull();
    expect(task!.priority).toBe(10);
    expect(task!.content).toBe('# Just a task\nDo the thing');
  });

  it('defaults priority to 10 when priority is non-numeric', () => {
    fs.writeFileSync(path.join(tmpDir, 'bad.md'), '---\npriority: high\n---\nTask');
    const intake = new TaskIntake(tmpDir);
    const task = intake.peek();
    expect(task!.priority).toBe(10);
  });

  it('skips empty files', () => {
    fs.writeFileSync(path.join(tmpDir, 'empty.md'), '   \n\n  ');
    const intake = new TaskIntake(tmpDir);
    expect(intake.peek()).toBeNull();
  });

  it('renames file to .claiming on peek', () => {
    fs.writeFileSync(path.join(tmpDir, 'task.md'), 'Do something');
    const intake = new TaskIntake(tmpDir);
    intake.peek();
    expect(fs.existsSync(path.join(tmpDir, 'task.md'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'task.md.claiming'))).toBe(true);
  });

  it('markProcessed moves file to processed/', () => {
    fs.writeFileSync(path.join(tmpDir, 'task.md'), 'Do something');
    const intake = new TaskIntake(tmpDir);
    const task = intake.peek()!;
    intake.markProcessed(task);
    expect(fs.existsSync(path.join(tmpDir, 'processed', 'task.md'))).toBe(true);
  });

  it('markFailed moves file to failed/', () => {
    fs.writeFileSync(path.join(tmpDir, 'task.md'), 'Do something');
    const intake = new TaskIntake(tmpDir);
    const task = intake.peek()!;
    intake.markFailed(task);
    expect(fs.existsSync(path.join(tmpDir, 'failed', 'task.md'))).toBe(true);
  });
});
