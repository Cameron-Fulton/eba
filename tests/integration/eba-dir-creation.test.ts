import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('.eba/ directory creation', () => {
  let targetDir: string;

  beforeEach(() => {
    targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eba-target-'));
  });

  afterEach(() => {
    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  it('creates .eba/ with subdirectories', () => {
    const ebaDir = path.join(targetDir, '.eba');
    fs.mkdirSync(ebaDir, { recursive: true });
    fs.mkdirSync(path.join(ebaDir, 'solutions'), { recursive: true });
    fs.mkdirSync(path.join(ebaDir, 'memory-packets'), { recursive: true });
    fs.mkdirSync(path.join(ebaDir, 'logs'), { recursive: true });

    expect(fs.existsSync(path.join(ebaDir, 'solutions'))).toBe(true);
    expect(fs.existsSync(path.join(ebaDir, 'memory-packets'))).toBe(true);
    expect(fs.existsSync(path.join(ebaDir, 'logs'))).toBe(true);
  });

  it('creates .gitignore when .git/ exists in target', () => {
    fs.mkdirSync(path.join(targetDir, '.git'));
    const ebaDir = path.join(targetDir, '.eba');
    fs.mkdirSync(ebaDir, { recursive: true });

    if (fs.existsSync(path.join(targetDir, '.git'))) {
      fs.writeFileSync(path.join(ebaDir, '.gitignore'), [
        '# EBA session artifacts',
        'logs/',
        'memory-packets/',
        '# Solutions are committed — curated project-specific knowledge',
        '',
      ].join('\n'));
    }

    expect(fs.existsSync(path.join(ebaDir, '.gitignore'))).toBe(true);
    const gitignore = fs.readFileSync(path.join(ebaDir, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('logs/');
    expect(gitignore).toContain('memory-packets/');
    expect(gitignore).not.toContain('solutions/');
  });

  it('does NOT create .gitignore when no .git/ in target', () => {
    const ebaDir = path.join(targetDir, '.eba');
    fs.mkdirSync(ebaDir, { recursive: true });

    if (fs.existsSync(path.join(targetDir, '.git'))) {
      fs.writeFileSync(path.join(ebaDir, '.gitignore'), 'logs/\nmemory-packets/\n');
    }

    expect(fs.existsSync(path.join(ebaDir, '.gitignore'))).toBe(false);
  });
});
