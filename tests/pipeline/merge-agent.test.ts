import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { mergePackets, MergeAgent } from '../../src/pipeline/merge-agent';
import { MemoryPacket } from '../../src/phase1/memory-packet';
import { VoteReceipt } from '../../src/pipeline/nk-vote-tracker';
import { NegativeKnowledgeStore } from '../../src/phase1/negative-knowledge';

function makePacket(overrides: Partial<MemoryPacket> = {}): MemoryPacket {
  return {
    id: 'pkt_test',
    timestamp: new Date().toISOString(),
    session_id: 'sess_test',
    summary: 'Base summary',
    decisions: [],
    rejected_ideas: [],
    risks: [],
    open_threads: [],
    key_file_changes: [],
    metadata: {
      original_token_count: 100,
      compressed_token_count: 20,
      compression_ratio: 5,
      fidelity_score: 0.97,
    },
    ...overrides,
  };
}

describe('mergePackets', () => {
  it('throws on empty array', () => {
    expect(() => mergePackets([])).toThrow();
  });

  it('returns shallow copy for single packet', () => {
    const p = makePacket();
    const result = mergePackets([p]);
    expect(result).not.toBe(p);
    expect(result.summary).toBe(p.summary);
  });

  it('rule 1: rejected_ideas accumulate and dedup', () => {
    const a = makePacket({
      rejected_ideas: [
        { idea: 'Use Redux', reason: 'Too complex' },
        { idea: 'Use MobX', reason: 'Not mainstream' },
      ],
    });
    const b = makePacket({
      rejected_ideas: [
        { idea: 'use redux', reason: 'Overkill' }, // duplicate (case-insensitive)
        { idea: 'Use Zustand', reason: 'Too new' },
      ],
    });
    const merged = mergePackets([a, b]);
    expect(merged.rejected_ideas).toHaveLength(3);
    // First occurrence wins — reason should be from packet a
    const redux = merged.rejected_ideas.find(
      r => r.idea.toLowerCase().includes('redux'),
    );
    expect(redux?.reason).toBe('Too complex');
  });

  it('rule 2: decisions later timestamp overrides', () => {
    const a = makePacket({
      decisions: [
        { description: 'Use PostgreSQL', rationale: 'Mature', timestamp: '2026-01-01T00:00:00Z' },
      ],
    });
    const b = makePacket({
      decisions: [
        { description: 'use postgresql', rationale: 'Best for our case', timestamp: '2026-02-01T00:00:00Z' },
      ],
    });
    const merged = mergePackets([a, b]);
    expect(merged.decisions).toHaveLength(1);
    expect(merged.decisions[0].rationale).toBe('Best for our case');
  });

  it('rule 3: risks accumulate, higher severity wins on dedup', () => {
    const a = makePacket({
      risks: [{ description: 'SQL injection', severity: 'low' }],
    });
    const b = makePacket({
      risks: [{ description: 'SQL Injection', severity: 'high', mitigation: 'Parameterize' }],
    });
    const merged = mergePackets([a, b]);
    expect(merged.risks).toHaveLength(1);
    expect(merged.risks[0].severity).toBe('high');
  });

  it('rule 4: open_threads merge by topic, blocked is sticky', () => {
    const a = makePacket({
      open_threads: [
        { topic: 'Auth system', status: 'blocked', context: 'Waiting on API key', blocked_reason: 'no key' },
      ],
    });
    const b = makePacket({
      open_threads: [
        { topic: 'auth system', status: 'next_up', context: 'Ready to go' },
      ],
    });
    const merged = mergePackets([a, b]);
    expect(merged.open_threads).toHaveLength(1);
    expect(merged.open_threads[0].status).toBe('blocked');
    // Later context replaces earlier if non-empty
    expect(merged.open_threads[0].context).toBe('Ready to go');
  });

  it('rule 5: key_file_changes latest action wins per path', () => {
    const a = makePacket({
      key_file_changes: [
        { path: 'src/index.ts', action: 'created', summary: 'Initial file' },
      ],
    });
    const b = makePacket({
      key_file_changes: [
        { path: 'src/index.ts', action: 'modified', summary: 'Added exports' },
      ],
    });
    const merged = mergePackets([a, b]);
    expect(merged.key_file_changes).toHaveLength(1);
    expect(merged.key_file_changes[0].action).toBe('modified');
    expect(merged.key_file_changes[0].summary).toBe('Added exports');
  });

  it('rule 6: entities merge with relationship override and also union', () => {
    const a = makePacket({
      entities: [
        { name: 'Acme Corp', relationship: 'client', urls: ['https://acme.com'], also: ['ACME'] },
      ],
    });
    const b = makePacket({
      entities: [
        { name: 'acme corp', relationship: 'partner', urls: ['https://acme.io'], also: ['AcmeCo'] },
      ],
    });
    const merged = mergePackets([a, b]);
    expect(merged.entities).toHaveLength(1);
    expect(merged.entities![0].relationship).toBe('partner');
    expect(merged.entities![0].urls).toContain('https://acme.com');
    expect(merged.entities![0].urls).toContain('https://acme.io');
    expect(merged.entities![0].also).toContain('ACME');
    expect(merged.entities![0].also).toContain('AcmeCo');
  });

  it('rule 7: vocabulary accumulates and dedup by term', () => {
    const a = makePacket({
      vocabulary: [
        { term: 'NK', definition: 'Negative Knowledge' },
        { term: 'SOP', definition: 'Standard Operating Procedure' },
      ],
    });
    const b = makePacket({
      vocabulary: [
        { term: 'nk', definition: 'Updated def' }, // dupe
        { term: 'EBA', definition: 'Episodic Blueprint Architecture' },
      ],
    });
    const merged = mergePackets([a, b]);
    expect(merged.vocabulary).toHaveLength(3);
    // First occurrence wins
    const nk = merged.vocabulary!.find(v => v.term.toLowerCase() === 'nk');
    expect(nk?.definition).toBe('Negative Knowledge');
  });

  it('rule 8: summaries concatenated with separator', () => {
    const a = makePacket({ summary: 'Session one work' });
    const b = makePacket({ summary: 'Session two work' });
    const merged = mergePackets([a, b]);
    expect(merged.summary).toBe('Session one work\n---\nSession two work');
  });

  it('rule 9: metadata recomputed from merged content', () => {
    const a = makePacket({
      metadata: {
        original_token_count: 1000,
        compressed_token_count: 200,
        compression_ratio: 5,
        fidelity_score: 0.95,
      },
    });
    const b = makePacket({
      metadata: {
        original_token_count: 500,
        compressed_token_count: 100,
        compression_ratio: 5,
        fidelity_score: 0.99,
      },
    });
    const merged = mergePackets([a, b]);
    expect(merged.metadata.original_token_count).toBe(1500);
    // Weighted average: (0.95*1000 + 0.99*500) / 1500 = (950+495)/1500 = 0.9633...
    expect(merged.metadata.fidelity_score).toBeCloseTo(0.9633, 3);
    expect(merged.metadata.compression_ratio).toBeGreaterThan(0);
  });

  it('rule 10: session_meta unions load_bearing_sections', () => {
    const a = makePacket({
      session_meta: {
        load_bearing_sections: ['decisions', 'risks'],
        token_budget_rationale: 'Budget A',
      },
    });
    const b = makePacket({
      session_meta: {
        load_bearing_sections: ['risks', 'open_threads'],
        token_budget_rationale: 'Budget B',
      },
    });
    const merged = mergePackets([a, b]);
    expect(merged.session_meta).toBeDefined();
    const sections = merged.session_meta!.load_bearing_sections!;
    expect(sections).toContain('decisions');
    expect(sections).toContain('risks');
    expect(sections).toContain('open_threads');
    expect(sections).toHaveLength(3);
    expect(merged.session_meta!.token_budget_rationale).toBe('Budget A\nBudget B');
  });

  it('unions vote_receipts from multiple packets', () => {
    const receipt1: VoteReceipt = { nk_id: 'nk_001', context_keys: ['jest'], succeeded: true, timestamp: '2026-01-01T00:00:00Z' };
    const receipt2: VoteReceipt = { nk_id: 'nk_002', context_keys: ['react'], succeeded: false, timestamp: '2026-01-02T00:00:00Z' };
    const a = makePacket({ vote_receipts: [receipt1] });
    const b = makePacket({ vote_receipts: [receipt2] });
    const merged = mergePackets([a, b]);
    expect(merged.vote_receipts).toHaveLength(2);
    expect(merged.vote_receipts![0].nk_id).toBe('nk_001');
    expect(merged.vote_receipts![1].nk_id).toBe('nk_002');
  });

  it('deduplicates vote_receipts by nk_id + context_keys', () => {
    const receipt1: VoteReceipt = { nk_id: 'nk_001', context_keys: ['jest', 'typescript'], succeeded: true, timestamp: '2026-01-01T00:00:00Z' };
    const receipt2: VoteReceipt = { nk_id: 'nk_001', context_keys: ['typescript', 'jest'], succeeded: false, timestamp: '2026-01-02T00:00:00Z' };
    const a = makePacket({ vote_receipts: [receipt1] });
    const b = makePacket({ vote_receipts: [receipt2] });
    const merged = mergePackets([a, b]);
    // Same nk_id + same context_keys (sorted) → deduped to 1
    expect(merged.vote_receipts).toHaveLength(1);
    expect(merged.vote_receipts![0].nk_id).toBe('nk_001');
  });

  it('omits vote_receipts when no packets have them', () => {
    const a = makePacket();
    const b = makePacket();
    const merged = mergePackets([a, b]);
    expect(merged.vote_receipts).toBeUndefined();
  });

  it('never-drop: rejected_ideas, entities, vocabulary survive merge with empty packet', () => {
    const full = makePacket({
      rejected_ideas: [{ idea: 'Use SOAP', reason: 'Ancient' }],
      entities: [{ name: 'GitHub', relationship: 'platform', urls: ['https://github.com'], also: [] }],
      vocabulary: [{ term: 'CI', definition: 'Continuous Integration' }],
    });
    const empty = makePacket();
    const merged = mergePackets([full, empty]);
    expect(merged.rejected_ideas).toHaveLength(1);
    expect(merged.entities).toHaveLength(1);
    expect(merged.vocabulary).toHaveLength(1);
  });
});

function writePacketFile(dir: string, packet: MemoryPacket, filename: string): void {
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(packet, null, 2));
}

describe('MergeAgent.sweep()', () => {
  let pendingDir: string;
  let packetsDir: string;
  let agent: MergeAgent;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eba-merge-'));
    pendingDir = path.join(tmpDir, 'pending_merge');
    packetsDir = path.join(tmpDir, 'memory-packets');
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.mkdirSync(packetsDir, { recursive: true });
    agent = new MergeAgent({ pendingDir, packetsDir });
  });

  test('returns merged:false when no pending files', async () => {
    const result = await agent.sweep();
    expect(result.merged).toBe(false);
    expect(result.packetCount).toBe(0);
  });

  test('merges pending packets and moves to processed/', async () => {
    const pkt = makePacket({
      rejected_ideas: [{ idea: 'Test idea', reason: 'Test reason' }],
    });
    writePacketFile(pendingDir, pkt, 'task_001.json');
    const result = await agent.sweep();
    expect(result.merged).toBe(true);
    expect(result.packetCount).toBe(1);
    expect(result.outputPath).not.toBeNull();
    expect(fs.existsSync(path.join(pendingDir, 'task_001.json'))).toBe(false);
    expect(fs.existsSync(path.join(pendingDir, 'processed', 'task_001.json'))).toBe(true);
    expect(fs.existsSync(result.outputPath!)).toBe(true);
  });

  test('preserves never-drop fields across multiple packets', async () => {
    const pkt1 = makePacket({
      rejected_ideas: [{ idea: 'Idea A', reason: 'Reason A' }],
      entities: [{ name: 'Entity1', relationship: 'ref', urls: [], also: [] }],
    });
    const pkt2 = makePacket({
      rejected_ideas: [{ idea: 'Idea B', reason: 'Reason B' }],
      vocabulary: [{ term: 'Term1', definition: 'Def1' }],
    });
    writePacketFile(pendingDir, pkt1, 'task_001.json');
    writePacketFile(pendingDir, pkt2, 'task_002.json');
    const result = await agent.sweep();
    const merged = JSON.parse(fs.readFileSync(result.outputPath!, 'utf-8'));
    expect(merged.rejected_ideas).toHaveLength(2);
    expect(merged.entities).toHaveLength(1);
    expect(merged.vocabulary).toHaveLength(1);
  });

  test('applies vote receipts to global NK store and strips from merged output', async () => {
    // Create a real NK store with temp dir
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eba-merge-vote-'));
    const nkDir = path.join(tmpDir, 'nk-solutions');
    fs.mkdirSync(nkDir, { recursive: true });
    const nkStore = new NegativeKnowledgeStore(nkDir);

    // Add an NK entry
    const entry = nkStore.add({
      scenario: 'Test scenario for vote',
      attempt: 'Failed attempt',
      outcome: 'Bad outcome',
      solution: 'The fix',
      tags: ['jest'],
    });
    nkStore.saveToDisk();

    // Create pending dir and packets dir for this test
    const votePendingDir = path.join(tmpDir, 'pending_merge');
    const votePacketsDir = path.join(tmpDir, 'memory-packets');
    fs.mkdirSync(votePendingDir, { recursive: true });
    fs.mkdirSync(votePacketsDir, { recursive: true });

    // Write a packet with vote_receipts
    const receipt: VoteReceipt = {
      nk_id: entry.id,
      context_keys: ['jest'],
      succeeded: true,
      timestamp: new Date().toISOString(),
    };
    const pkt = makePacket({ vote_receipts: [receipt] });
    writePacketFile(votePendingDir, pkt, 'task_vote_001.json');

    const voteAgent = new MergeAgent({
      pendingDir: votePendingDir,
      packetsDir: votePacketsDir,
      globalNkStore: nkStore,
    });

    const result = await voteAgent.sweep();
    expect(result.merged).toBe(true);

    // Verify the merged output does NOT contain vote_receipts
    const mergedJson = JSON.parse(fs.readFileSync(result.outputPath!, 'utf-8'));
    expect(mergedJson.vote_receipts).toBeUndefined();

    // Verify the NK entry was updated with votes
    nkStore.loadFromDisk();
    const updatedEntry = nkStore.get(entry.id);
    expect(updatedEntry).toBeDefined();
    expect(updatedEntry!.vote_metrics).toBeDefined();
    expect(updatedEntry!.vote_metrics!.contexts['jest'].total_attempts).toBe(1);
    expect(updatedEntry!.vote_metrics!.contexts['jest'].successes).toBe(1);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('handles crash recovery — master packet with unprocessed receipts', async () => {
    // Create a real NK store with temp dir
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eba-merge-crash-'));
    const nkDir = path.join(tmpDir, 'nk-solutions');
    fs.mkdirSync(nkDir, { recursive: true });
    const nkStore = new NegativeKnowledgeStore(nkDir);

    const entry = nkStore.add({
      scenario: 'Crash recovery scenario',
      attempt: 'Failed attempt',
      outcome: 'Bad outcome',
      solution: 'The fix',
      tags: ['typescript'],
    });
    nkStore.saveToDisk();

    const crashPendingDir = path.join(tmpDir, 'pending_merge');
    const crashPacketsDir = path.join(tmpDir, 'memory-packets');
    fs.mkdirSync(crashPendingDir, { recursive: true });
    fs.mkdirSync(crashPacketsDir, { recursive: true });

    // Simulate a master packet already in packetsDir (from a previous merge)
    const masterReceipt: VoteReceipt = {
      nk_id: entry.id,
      context_keys: ['typescript'],
      succeeded: false,
      timestamp: new Date().toISOString(),
    };
    const masterPkt = makePacket({
      session_id: 'master_session',
      vote_receipts: [masterReceipt],
    });
    writePacketFile(crashPacketsDir, masterPkt, 'master_session_merged.json');

    // New pending packet with another receipt for the same entry
    const newReceipt: VoteReceipt = {
      nk_id: entry.id,
      context_keys: ['typescript'],
      succeeded: true,
      timestamp: new Date().toISOString(),
    };
    const newPkt = makePacket({
      session_id: 'new_session',
      vote_receipts: [newReceipt],
    });
    writePacketFile(crashPendingDir, newPkt, 'new_session.json');

    const crashAgent = new MergeAgent({
      pendingDir: crashPendingDir,
      packetsDir: crashPacketsDir,
      globalNkStore: nkStore,
    });

    const result = await crashAgent.sweep();
    expect(result.merged).toBe(true);

    // Both receipts should have been applied (master + new)
    nkStore.loadFromDisk();
    const updatedEntry = nkStore.get(entry.id);
    expect(updatedEntry).toBeDefined();
    expect(updatedEntry!.vote_metrics).toBeDefined();
    expect(updatedEntry!.vote_metrics!.contexts['typescript'].total_attempts).toBe(2);
    expect(updatedEntry!.vote_metrics!.contexts['typescript'].successes).toBe(1);

    // Merged output should not have vote_receipts
    const mergedJson = JSON.parse(fs.readFileSync(result.outputPath!, 'utf-8'));
    expect(mergedJson.vote_receipts).toBeUndefined();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
