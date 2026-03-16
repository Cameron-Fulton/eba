/**
 * Phase 3: Three-Pillar Model (3PM)
 * Transparency: all state changes logged with timestamps
 * Accountability: decision journal tracking who/what made each choice
 * Trustworthiness: risk threshold system — high-risk actions trigger approval
 */

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ActionClassification {
  action: string;
  category: string;
  risk_level: RiskLevel;
  requires_approval: boolean;
}

export interface StateChangeLog {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  before: string;
  after: string;
  risk_level: RiskLevel;
}

export interface DecisionJournalEntry {
  id: string;
  timestamp: string;
  actor: string;
  decision: string;
  rationale: string;
  alternatives_considered: string[];
  risk_level: RiskLevel;
}

export interface ApprovalRequest {
  id: string;
  timestamp: string;
  action: string;
  risk_level: RiskLevel;
  requested_by: string;
  status: 'pending' | 'approved' | 'denied';
  decided_by?: string;
  decided_at?: string;
}

export type ApprovalHandler = (request: ApprovalRequest) => Promise<boolean>;

const DEFAULT_ACTION_CLASSIFICATIONS: ActionClassification[] = [
  { action: 'file_read', category: 'filesystem', risk_level: 'low', requires_approval: false },
  { action: 'file_write', category: 'filesystem', risk_level: 'medium', requires_approval: false },
  { action: 'file_delete', category: 'filesystem', risk_level: 'high', requires_approval: true },
  { action: 'db_read', category: 'database', risk_level: 'low', requires_approval: false },
  { action: 'db_write', category: 'database', risk_level: 'high', requires_approval: true },
  { action: 'db_delete', category: 'database', risk_level: 'critical', requires_approval: true },
  { action: 'deploy', category: 'infrastructure', risk_level: 'critical', requires_approval: true },
  { action: 'config_change', category: 'infrastructure', risk_level: 'high', requires_approval: true },
  { action: 'test_run', category: 'execution', risk_level: 'low', requires_approval: false },
  { action: 'bash_execute', category: 'execution', risk_level: 'medium', requires_approval: false },
  { action: 'consortium_escalation', category: 'orchestration', risk_level: 'high', requires_approval: true },
  { action: 'memory_packet_write', category: 'filesystem', risk_level: 'low', requires_approval: false },
];

export class ThreePillarModel {
  // Transparency
  private stateChanges: StateChangeLog[] = [];
  // Accountability
  private decisionJournal: DecisionJournalEntry[] = [];
  // Trustworthiness
  private approvalRequests: ApprovalRequest[] = [];
  private actionClassifications: Map<string, ActionClassification> = new Map();
  private approvalHandler: ApprovalHandler;

  constructor(approvalHandler?: ApprovalHandler) {
    this.approvalHandler = approvalHandler ?? (async () => true);
    for (const c of DEFAULT_ACTION_CLASSIFICATIONS) {
      this.actionClassifications.set(c.action, c);
    }
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  }

  // --- Transparency ---
  logStateChange(actor: string, action: string, before: string, after: string): StateChangeLog {
    const classification = this.actionClassifications.get(action);
    const log: StateChangeLog = {
      id: this.generateId('sc'),
      timestamp: new Date().toISOString(),
      actor,
      action,
      before,
      after,
      risk_level: classification?.risk_level ?? 'medium',
    };
    this.stateChanges.push(log);
    return log;
  }

  getStateChanges(since?: string): StateChangeLog[] {
    if (!since) return [...this.stateChanges];
    return this.stateChanges.filter(sc => sc.timestamp >= since);
  }

  // --- Accountability ---

  recordDecision(
    actor: string,
    decision: string,
    rationale: string,
    alternatives: string[] = [],
    riskLevel: RiskLevel = 'low'
  ): DecisionJournalEntry {
    const entry: DecisionJournalEntry = {
      id: this.generateId('dj'),
      timestamp: new Date().toISOString(),
      actor,
      decision,
      rationale,
      alternatives_considered: alternatives,
      risk_level: riskLevel,
    };
    this.decisionJournal.push(entry);
    return entry;
  }

  getDecisionJournal(): DecisionJournalEntry[] {
    return [...this.decisionJournal];
  }

  // --- Trustworthiness ---

  classifyAction(action: string): ActionClassification | undefined {
    return this.actionClassifications.get(action);
  }

  registerActionClassification(classification: ActionClassification): void {
    this.actionClassifications.set(classification.action, classification);
  }

  setApprovalHandler(handler: ApprovalHandler): void {
    this.approvalHandler = handler;
  }

  async checkAndApprove(action: string, requestedBy: string): Promise<{ approved: boolean; request: ApprovalRequest }> {
    const classification = this.actionClassifications.get(action);
    const riskLevel = classification?.risk_level ?? 'medium';
    const needsApproval = classification?.requires_approval ?? (riskLevel === 'high' || riskLevel === 'critical');

    const request: ApprovalRequest = {
      id: this.generateId('ar'),
      timestamp: new Date().toISOString(),
      action,
      risk_level: riskLevel,
      requested_by: requestedBy,
      status: 'pending',
    };

    if (!needsApproval) {
      request.status = 'approved';
      request.decided_by = 'system';
      request.decided_at = new Date().toISOString();
      this.approvalRequests.push(request);
      return { approved: true, request };
    }

    const approved = await this.approvalHandler(request);
    request.status = approved ? 'approved' : 'denied';
    request.decided_by = 'human';
    request.decided_at = new Date().toISOString();
    this.approvalRequests.push(request);

    return { approved, request };
  }

  getApprovalRequests(): ApprovalRequest[] {
    return [...this.approvalRequests];
  }

  getRiskLevel(action: string): RiskLevel {
    return this.actionClassifications.get(action)?.risk_level ?? 'medium';
  }
}
