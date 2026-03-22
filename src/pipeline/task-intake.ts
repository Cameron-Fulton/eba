// src/pipeline/task-intake.ts
import * as fs from 'fs';
import * as path from 'path';

export interface IntakeTask {
  content: string;
  priority: number;
  sourcePath: string;
}

export class TaskIntake {
  private intakeDir: string;

  constructor(intakeDir: string) {
    this.intakeDir = intakeDir;
  }

  peek(): IntakeTask | null {
    if (!fs.existsSync(this.intakeDir)) return null;

    const files = fs.readdirSync(this.intakeDir)
      .filter(f => f.endsWith('.md') && !f.endsWith('.claiming'));

    if (files.length === 0) return null;

    const parsed = files.flatMap(f => {
      const fullPath = path.join(this.intakeDir, f);
      try {
        const raw = fs.readFileSync(fullPath, 'utf-8');
        const { content, priority } = this.parseFrontmatter(raw);
        const mtime = fs.statSync(fullPath).mtimeMs;
        return content.trim().length > 0 ? [{ content, priority, sourcePath: fullPath, mtime }] : [];
      } catch {
        return []; // file was claimed or removed by another process
      }
    });

    if (parsed.length === 0) return null;

    parsed.sort((a, b) => b.priority - a.priority || a.mtime - b.mtime);

    const best = parsed[0];
    const claimPath = best.sourcePath + '.claiming';
    try {
      fs.renameSync(best.sourcePath, claimPath);
    } catch (err: unknown) {
      // Lost race — another process claimed this file
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }

    return { content: best.content, priority: best.priority, sourcePath: claimPath };
  }

  markProcessed(task: IntakeTask): void {
    const processedDir = path.join(this.intakeDir, 'processed');
    fs.mkdirSync(processedDir, { recursive: true });
    const basename = path.basename(task.sourcePath).replace(/\.claiming$/, '');
    fs.renameSync(task.sourcePath, path.join(processedDir, basename));
  }

  markFailed(task: IntakeTask): void {
    const failedDir = path.join(this.intakeDir, 'failed');
    fs.mkdirSync(failedDir, { recursive: true });
    const basename = path.basename(task.sourcePath).replace(/\.claiming$/, '');
    fs.renameSync(task.sourcePath, path.join(failedDir, basename));
  }

  private parseFrontmatter(raw: string): { content: string; priority: number } {
    const normalized = raw.replace(/\r\n/g, '\n');
    const match = normalized.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    if (!match) return { content: raw.trim(), priority: 10 };

    const frontmatter = match[1];
    const content = match[2].trim();
    const priorityMatch = frontmatter.match(/priority:\s*(-?\d+)/);
    const priority = priorityMatch ? parseInt(priorityMatch[1], 10) : 10;

    return { content, priority };
  }
}
