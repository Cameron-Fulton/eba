import { SOPEngine, createRefactoringSOP } from '../../src/phase2/sop';

describe('SOP Engine', () => {
  let engine: SOPEngine;

  beforeEach(() => {
    engine = new SOPEngine();
    engine.register(createRefactoringSOP());
  });

  test('registers and starts an SOP', () => {
    const step = engine.start('refactoring');
    expect(step.id).toBe('analyze');
    expect(step.name).toBe('Analyze Code');
  });

  test('throws on starting unknown SOP', () => {
    expect(() => engine.start('nonexistent')).toThrow("SOP 'nonexistent' not found");
  });

  test('advances to valid next step', () => {
    engine.start('refactoring');
    const step = engine.advance('plan');
    expect(step.id).toBe('plan');
  });

  test('rejects invalid step transition', () => {
    engine.start('refactoring');
    expect(() => engine.advance('complete')).toThrow('Cannot advance');
  });

  test('filters tools by current step categories', () => {
    engine.start('refactoring'); // analyze step
    const categories = engine.getAllowedToolCategories();
    expect(categories).toContain('read');
    expect(categories).toContain('search');
    expect(categories).toContain('analyze');
    expect(categories).not.toContain('write');
    expect(categories).not.toContain('execute');
  });

  test('isToolAllowed checks category', () => {
    engine.start('refactoring'); // analyze step: read, search, analyze
    expect(engine.isToolAllowed('file_read', 'read')).toBe(true);
    expect(engine.isToolAllowed('file_write', 'write')).toBe(false);
  });

  test('implement step allows write tools', () => {
    engine.start('refactoring');
    engine.advance('plan');
    engine.advance('implement');
    expect(engine.isToolAllowed('file_write', 'write')).toBe(true);
    expect(engine.isToolAllowed('bash_execute', 'execute')).toBe(false);
  });

  test('tracks step history', () => {
    engine.start('refactoring');
    engine.advance('plan');
    engine.advance('implement');
    const history = engine.getHistory();
    expect(history).toEqual(['analyze', 'plan', 'implement']);
  });

  test('rejects SOP with invalid initial step', () => {
    expect(() =>
      engine.register({
        id: 'bad',
        name: 'Bad SOP',
        description: 'Invalid',
        initial_step: 'nonexistent',
        steps: [{ id: 'step1', name: 'S1', description: 'S1', allowed_tool_categories: [], next_steps: [] }],
      })
    ).toThrow("Initial step 'nonexistent' not found");
  });

  test('rejects SOP with invalid next_steps reference', () => {
    expect(() =>
      engine.register({
        id: 'bad2',
        name: 'Bad SOP 2',
        description: 'Invalid',
        initial_step: 'step1',
        steps: [{ id: 'step1', name: 'S1', description: 'S1', allowed_tool_categories: [], next_steps: ['ghost'] }],
      })
    ).toThrow("references unknown next step 'ghost'");
  });
});
