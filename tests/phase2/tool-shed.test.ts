import { ToolShed, ToolSchema, createDefaultToolShed } from '../../src/phase2/tool-shed';

describe('Tool Shed', () => {
  test('registers and retrieves a tool', () => {
    const shed = new ToolShed();
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
    const shed = new ToolShed();
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
