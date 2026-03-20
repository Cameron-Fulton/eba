import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ToolShed, ToolExecutionResult, createDefaultToolShed } from '../../src/phase2/tool-shed';

describe('ToolShed.execute()', () => {
  let tempDir: string;
  let shed: ToolShed;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-executor-'));
    shed = createDefaultToolShed();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('file_read', () => {
    test('file_read returns file contents', () => {
      const filePath = path.join(tempDir, 'hello.txt');
      fs.writeFileSync(filePath, 'hello world', 'utf-8');

      const result = shed.execute('file_read', { path: filePath });

      expect(result.success).toBe(true);
      expect(result.output).toBe('hello world');
    });

    test('file_read returns error for missing file', () => {
      const missingPath = path.join(tempDir, 'does-not-exist.txt');

      const result = shed.execute('file_read', { path: missingPath });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('file_write', () => {
    test('file_write creates a file with content', () => {
      const filePath = path.join(tempDir, 'written.txt');

      const result = shed.execute('file_write', { path: filePath, content: 'written content' });

      expect(result.success).toBe(true);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('written content');
    });

    test('file_write creates intermediate directories', () => {
      const filePath = path.join(tempDir, 'deep', 'nested', 'output.txt');

      const result = shed.execute('file_write', { path: filePath, content: 'nested content' });

      expect(result.success).toBe(true);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  describe('file_edit', () => {
    test('file_edit replaces old_text with new_text', () => {
      const filePath = path.join(tempDir, 'edit.txt');
      fs.writeFileSync(filePath, 'foo bar baz', 'utf-8');

      const result = shed.execute('file_edit', {
        path: filePath,
        old_text: 'bar',
        new_text: 'QUX',
      });

      expect(result.success).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('foo QUX baz');
    });

    test('file_edit returns error when old_text not found', () => {
      const filePath = path.join(tempDir, 'edit-miss.txt');
      fs.writeFileSync(filePath, 'foo bar baz', 'utf-8');

      const result = shed.execute('file_edit', {
        path: filePath,
        old_text: 'NOTHERE',
        new_text: 'QUX',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('old_text not found');
    });
  });

  describe('bash_execute', () => {
    test('bash_execute runs a command and returns output', () => {
      const result = shed.execute('bash_execute', { command: 'echo hello_from_bash' }, tempDir);

      expect(result.success).toBe(true);
      expect(result.output.trim()).toBe('hello_from_bash');
    });

    test('bash_execute returns error for failing command', () => {
      const result = shed.execute('bash_execute', { command: 'exit 1' }, tempDir);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('grep_search', () => {
    test('grep_search finds pattern in .ts files', () => {
      const sampleFile = path.join(tempDir, 'sample.ts');
      fs.writeFileSync(sampleFile, 'export const greeting = "hello";', 'utf-8');

      const result = shed.execute('grep_search', { pattern: 'greeting', path: tempDir }, tempDir);

      expect(result.success).toBe(true);
      expect(result.output).toContain('greeting');
    });

    test('grep_search returns (no matches) when nothing found', () => {
      const result = shed.execute('grep_search', { pattern: 'xyzzy_no_match_12345', path: tempDir }, tempDir);

      expect(result.success).toBe(true);
      expect(result.output).toBe('(no matches)');
    });
  });

  describe('glob_find', () => {
    test('glob_find finds files matching pattern', () => {
      fs.writeFileSync(path.join(tempDir, 'foo.ts'), 'export {}', 'utf-8');
      fs.writeFileSync(path.join(tempDir, 'bar.ts'), 'export {}', 'utf-8');

      const result = shed.execute('glob_find', { pattern: '*.ts' }, tempDir);

      expect(result.success).toBe(true);
      expect(result.output).toContain('.ts');
    });
  });

  describe('code_analyzer', () => {
    test('code_analyzer returns analysis target info', () => {
      const result = shed.execute('code_analyzer', { path: '/some/path' });

      expect(result.success).toBe(true);
      expect(result.output).toContain('/some/path');
    });
  });

  describe('unknown tool', () => {
    test('unknown tool returns error', () => {
      const result = shed.execute('nonexistent_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown tool');
    });
  });

  describe('ToolExecutionResult type', () => {
    test('success result has success:true and a string output', () => {
      const result: ToolExecutionResult = shed.execute('code_analyzer', { path: '/type/success' });

      expect(result.success).toBe(true);
      expect(typeof result.output).toBe('string');
      expect(result.error).toBeUndefined();
    });

    test('failure result has success:false and error string', () => {
      const missingPath = path.join(tempDir, 'missing-for-type.txt');
      const result: ToolExecutionResult = shed.execute('file_read', { path: missingPath });

      expect(result.success).toBe(false);
      expect(typeof result.error).toBe('string');
    });
  });
});
