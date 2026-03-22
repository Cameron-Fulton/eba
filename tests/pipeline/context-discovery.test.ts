import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ContextDiscovery } from '../../src/pipeline/context-discovery';

describe('ContextDiscovery', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eba-ctx-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads CLAUDE.md from project root', () => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# Project Rules\nUse TypeScript');
    const discovery = new ContextDiscovery(tmpDir, '/nonexistent/SYSTEM.md');
    const ctx = discovery.discover();
    expect(ctx.content).toContain('Use TypeScript');
    expect(ctx.sources).toContain(path.join(tmpDir, 'CLAUDE.md'));
  });

  it('reads AGENTS.md alongside CLAUDE.md', () => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), 'Claude rules');
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), 'Agent config');
    const ctx = new ContextDiscovery(tmpDir, '/nonexistent/SYSTEM.md').discover();
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.content).toContain('Claude rules');
    expect(ctx.content).toContain('Agent config');
  });

  it('reads SYSTEM.md from custom path', () => {
    const systemPath = path.join(tmpDir, 'SYSTEM.md');
    fs.writeFileSync(systemPath, 'System-wide rules');
    const ctx = new ContextDiscovery(tmpDir, systemPath).discover();
    expect(ctx.content).toContain('System-wide rules');
    expect(ctx.sources).toContain(systemPath);
  });

  it('falls back to scanning .md files when no primary docs exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'Project readme');
    const ctx = new ContextDiscovery(tmpDir, '/nonexistent/SYSTEM.md').discover();
    expect(ctx.sources.length).toBeGreaterThanOrEqual(1);
    expect(ctx.content).toContain('Project readme');
  });

  it('parses markdown link references from docs', () => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'),
      'See [architecture](docs/ARCH.md) for details');
    fs.mkdirSync(path.join(tmpDir, 'docs'));
    fs.writeFileSync(path.join(tmpDir, 'docs', 'ARCH.md'), 'Architecture doc');
    const ctx = new ContextDiscovery(tmpDir, '/nonexistent/SYSTEM.md').discover();
    expect(ctx.content).toContain('Architecture doc');
    expect(ctx.sources).toContain(path.join(tmpDir, 'docs', 'ARCH.md'));
  });

  it('reads .eba.json context array', () => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), 'Base rules');
    fs.writeFileSync(path.join(tmpDir, 'extra.md'), 'Extra context');
    fs.writeFileSync(path.join(tmpDir, '.eba.json'),
      JSON.stringify({ context: ['extra.md'] }));
    const ctx = new ContextDiscovery(tmpDir, '/nonexistent/SYSTEM.md').discover();
    expect(ctx.content).toContain('Extra context');
  });

  it('truncates at 50,000 characters', () => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), 'x'.repeat(60_000));
    const ctx = new ContextDiscovery(tmpDir, '/nonexistent/SYSTEM.md').discover();
    expect(ctx.truncated).toBe(true);
    expect(ctx.content).toContain('[Context truncated');
  });

  it('returns empty content when no files found', () => {
    const ctx = new ContextDiscovery(tmpDir, '/nonexistent/SYSTEM.md').discover();
    expect(ctx.content).toBe('');
    expect(ctx.sources).toHaveLength(0);
    expect(ctx.truncated).toBe(false);
  });

  it('skips invalid .eba.json gracefully', () => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), 'Rules');
    fs.writeFileSync(path.join(tmpDir, '.eba.json'), 'not valid json{{{');
    const ctx = new ContextDiscovery(tmpDir, '/nonexistent/SYSTEM.md').discover();
    expect(ctx.content).toContain('Rules');
  });

  it('blocks path traversal in markdown references', () => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'),
      'See [secret](../../../etc/passwd.md) for details');
    const ctx = new ContextDiscovery(tmpDir, '/nonexistent/SYSTEM.md').discover();
    // Only CLAUDE.md should be in sources — the traversal target must not be read
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.content).not.toContain('## Referenced:');
  });

  it('blocks path traversal in .eba.json context', () => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), 'Rules');
    fs.writeFileSync(path.join(tmpDir, '.eba.json'),
      JSON.stringify({ context: ['../../../etc/shadow.md'] }));
    const ctx = new ContextDiscovery(tmpDir, '/nonexistent/SYSTEM.md').discover();
    expect(ctx.sources).toHaveLength(1); // only CLAUDE.md
  });
});
