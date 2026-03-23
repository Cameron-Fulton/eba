import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ToolShed, ToolSchema, ToolShedConfig, createDefaultToolShed } from '../../src/phase2/tool-shed';

describe('Tool Shed', () => {
  test('registers and retrieves a tool', () => {
    const shed = new ToolShed({ projectRoot: process.cwd() });
    const tool: ToolSchema = {
      name: 'my_tool',
      description: 'A test tool',
      category: 'read',
      parameters: [],
      risk_level: 'low',
    };

    shed.register(tool);
    expect(shed.get('my_tool')).toEqual(tool);
  });

  test('unregisters a tool', () => {
    const shed = new ToolShed({ projectRoot: process.cwd() });
    shed.register({
      name: 'temp_tool',
      description: 'Temporary',
      category: 'write',
      parameters: [],
      risk_level: 'low',
    });

    expect(shed.unregister('temp_tool')).toBe(true);
    expect(shed.get('temp_tool')).toBeUndefined();
    expect(shed.unregister('temp_tool')).toBe(false);
  });

  test('filters tools by category', () => {
    const shed = createDefaultToolShed();
    const readTools = shed.getByCategory('read');
    expect(readTools.length).toBeGreaterThan(0);
    expect(readTools.every(t => t.category === 'read')).toBe(true);
  });

  test('filters tools by risk level', () => {
    const shed = createDefaultToolShed();
    const highRisk = shed.getByRiskLevel('high');
    expect(highRisk.length).toBeGreaterThan(0);
    expect(highRisk.every(t => t.risk_level === 'high')).toBe(true);
  });

  test('selects relevant tools for a read task', () => {
    const shed = createDefaultToolShed();
    const selected = shed.selectTools('read the configuration file', 3);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.length).toBeLessThanOrEqual(3);
    expect(selected.some(t => t.category === 'read' || t.category === 'search')).toBe(true);
  });

  test('selects relevant tools for a write task', () => {
    const shed = createDefaultToolShed();
    const selected = shed.selectTools('create a new module file', 3);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.some(t => t.category === 'write')).toBe(true);
  });

  test('selects relevant tools for an execute task', () => {
    const shed = createDefaultToolShed();
    const selected = shed.selectTools('run the test suite', 3);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.some(t => t.category === 'execute')).toBe(true);
  });

  test('returns empty array for irrelevant task', () => {
    const shed = createDefaultToolShed();
    const selected = shed.selectTools('xq zz qq', 3);
    expect(selected).toHaveLength(0);
  });

  test('accepts ToolShedConfig object', () => {
    const shed = new ToolShed({ projectRoot: '/tmp/test-project' });
    expect(shed).toBeDefined();
  });

  test('createDefaultToolShed accepts config object', () => {
    const shed = createDefaultToolShed({ projectRoot: '/tmp/test-project' });
    expect(shed.get('file_read')).toBeDefined();
  });

  test('default tool shed has expected tools', () => {
    const shed = createDefaultToolShed();
    const all = shed.getAll();
    expect(all.length).toBeGreaterThanOrEqual(8);
    expect(shed.get('file_read')).toBeDefined();
    expect(shed.get('file_write')).toBeDefined();
    expect(shed.get('bash_execute')).toBeDefined();
    expect(shed.get('grep_search')).toBeDefined();
  });
});

describe('command blocklist', () => {
  let shed: ToolShed;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-blocklist-'));
    shed = createDefaultToolShed({ projectRoot: tempDir });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('blocks rm in chained command', () => {
    const result = shed.execute('bash_execute', { command: 'npm run build && rm -rf /' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('blocked');
  });

  test('blocks rmdir as standalone', () => {
    const result = shed.execute('bash_execute', { command: 'rmdir /s /q C:\\' });
    expect(result.success).toBe(false);
  });

  test('blocks dd in piped command', () => {
    const result = shed.execute('bash_execute', { command: 'npm run dump | dd of=/dev/sda' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('blocked');
  });

  test('blocks killall after semicolon', () => {
    const result = shed.execute('bash_execute', { command: 'git status ; killall node' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('blocked');
  });

  test('blocks del after || operator', () => {
    const result = shed.execute('bash_execute', { command: 'npm run build || del /f /q *' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('blocked');
  });

  test('allows npm commands that are not blocklisted', () => {
    const result = shed.execute('bash_execute', { command: 'npm --version' });
    expect(result.error ?? '').not.toContain('blocked');
  });
});

describe('custom allowlist', () => {
  test('replaces defaults when allowedPrefixes provided', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-allowlist-'));
    try {
      const shed = createDefaultToolShed({
        projectRoot: tempDir,
        allowedPrefixes: ['python', 'pytest', 'pip'],
      });
      // python should be allowed
      const result = shed.execute('bash_execute', { command: 'python --version' });
      expect(result.error ?? '').not.toContain('not allowed');

      // npm should NOT be allowed (replaced by custom list)
      const npmResult = shed.execute('bash_execute', { command: 'npm --version' });
      expect(npmResult.success).toBe(false);
      expect(npmResult.error).toContain('not allowed');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('git is always allowed even with custom allowlist', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-git-'));
    try {
      const shed = createDefaultToolShed({
        projectRoot: tempDir,
        allowedPrefixes: ['python'],
      });
      const result = shed.execute('bash_execute', { command: 'git status' });
      expect(result.error ?? '').not.toContain('not allowed');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('search tool path validation', () => {
  let tempDir: string;
  let shed: ToolShed;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-search-'));
    shed = createDefaultToolShed({ projectRoot: tempDir });
    fs.writeFileSync(path.join(tempDir, 'hello.ts'), 'export const x = 1;');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('grep_search defaults to projectRoot, not cwd', () => {
    const result = shed.execute('grep_search', { pattern: 'export' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello.ts');
  });

  test('grep_search rejects path outside projectRoot', () => {
    const result = shed.execute('grep_search', { pattern: 'export', path: '/etc' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('escapes project root');
  });

  test('glob_find defaults to projectRoot, not cwd', () => {
    const result = shed.execute('glob_find', { pattern: '*.ts' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello.ts');
  });

  test('glob_find rejects path outside projectRoot', () => {
    const result = shed.execute('glob_find', { pattern: '*.ts', path: '/etc' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('escapes project root');
  });
});
