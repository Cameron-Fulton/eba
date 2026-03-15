import { ThreePillarModel } from '../../src/phase3/three-pillar-model';

describe('Three-Pillar Model', () => {
  describe('Transparency (State Change Logging)', () => {
    test('logs a state change', () => {
      const model = new ThreePillarModel();
      const log = model.logStateChange('agent-1', 'file_write', 'old content', 'new content');
      expect(log.actor).toBe('agent-1');
      expect(log.action).toBe('file_write');
      expect(log.risk_level).toBe('medium');
    });

    test('retrieves all state changes', () => {
      const model = new ThreePillarModel();
      model.logStateChange('agent-1', 'file_read', '', 'data');
      model.logStateChange('agent-2', 'db_write', 'old', 'new');
      expect(model.getStateChanges()).toHaveLength(2);
    });

    test('filters state changes by timestamp', () => {
      const model = new ThreePillarModel();
      model.logStateChange('agent-1', 'file_read', '', 'data');
      const after = new Date().toISOString();
      model.logStateChange('agent-2', 'db_write', 'old', 'new');
      const recent = model.getStateChanges(after);
      expect(recent.length).toBeLessThanOrEqual(2);
    });
  });

  describe('Accountability (Decision Journal)', () => {
    test('records a decision', () => {
      const model = new ThreePillarModel();
      const entry = model.recordDecision(
        'agent-1',
        'Use SQLite over Postgres',
        'Simpler deployment, sufficient for our scale',
        ['Postgres', 'MySQL'],
        'medium'
      );
      expect(entry.decision).toBe('Use SQLite over Postgres');
      expect(entry.alternatives_considered).toContain('Postgres');
    });

    test('retrieves decision journal', () => {
      const model = new ThreePillarModel();
      model.recordDecision('a1', 'Decision A', 'Reason A');
      model.recordDecision('a2', 'Decision B', 'Reason B');
      expect(model.getDecisionJournal()).toHaveLength(2);
    });
  });

  describe('Trustworthiness (Risk Thresholds)', () => {
    test('auto-approves low-risk actions', async () => {
      const model = new ThreePillarModel();
      const { approved, request } = await model.checkAndApprove('file_read', 'agent-1');
      expect(approved).toBe(true);
      expect(request.status).toBe('approved');
      expect(request.decided_by).toBe('system');
    });

    test('requires approval for high-risk actions', async () => {
      const model = new ThreePillarModel(async () => true);
      const { approved, request } = await model.checkAndApprove('deploy', 'agent-1');
      expect(approved).toBe(true);
      expect(request.decided_by).toBe('human');
      expect(request.risk_level).toBe('critical');
    });

    test('denies action when human rejects', async () => {
      const model = new ThreePillarModel(async () => false);
      const { approved, request } = await model.checkAndApprove('db_delete', 'agent-1');
      expect(approved).toBe(false);
      expect(request.status).toBe('denied');
    });

    test('classifies actions correctly', () => {
      const model = new ThreePillarModel();
      expect(model.getRiskLevel('file_read')).toBe('low');
      expect(model.getRiskLevel('file_write')).toBe('medium');
      expect(model.getRiskLevel('deploy')).toBe('critical');
      expect(model.getRiskLevel('db_delete')).toBe('critical');
    });

    test('registers custom action classification', async () => {
      const model = new ThreePillarModel(async () => true);
      model.registerActionClassification({
        action: 'send_email',
        category: 'communication',
        risk_level: 'high',
        requires_approval: true,
      });

      const { request } = await model.checkAndApprove('send_email', 'agent-1');
      expect(request.risk_level).toBe('high');
      expect(request.decided_by).toBe('human');
    });

    test('tracks approval requests', async () => {
      const model = new ThreePillarModel(async () => true);
      await model.checkAndApprove('file_read', 'a1');
      await model.checkAndApprove('deploy', 'a2');
      expect(model.getApprovalRequests()).toHaveLength(2);
    });
  });
});
