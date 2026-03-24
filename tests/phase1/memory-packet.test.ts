import {
  MemoryPacket,
  validateMemoryPacket,
  serializePacket,
  deserializePacket,
  compressTranscript,
} from '../../src/phase1/memory-packet';
import { VoteReceipt } from '../../src/pipeline/nk-vote-tracker';

function createValidPacket(): MemoryPacket {
  return {
    id: 'pkt_test_001',
    timestamp: new Date().toISOString(),
    session_id: 'session_abc',
    decisions: [
      { description: 'Use TypeScript', rationale: 'Type safety', timestamp: new Date().toISOString() },
    ],
    rejected_ideas: [
      { idea: 'Use Python', reason: 'Team prefers TS' },
    ],
    risks: [
      { description: 'Tight deadline', severity: 'medium' },
    ],
    open_threads: [
      { topic: 'Database choice', status: 'active', context: 'Evaluating SQLite vs Postgres' },
    ],
    key_file_changes: [
      { path: 'src/index.ts', action: 'created', summary: 'Entry point' },
    ],
    summary: 'Initial project setup with TypeScript',
    metadata: {
      original_token_count: 5000,
      compressed_token_count: 250,
      compression_ratio: 20,
      fidelity_score: 0.97,
    },
  };
}

describe('Memory Packet Validation', () => {
  test('validates a correct packet', () => {
    const result = validateMemoryPacket(createValidPacket());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('rejects null input', () => {
    const result = validateMemoryPacket(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Packet must be a non-null object');
  });

  test('rejects packet missing required fields', () => {
    const result = validateMemoryPacket({ id: 'test' });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('rejects packet with wrong field types', () => {
    const packet = createValidPacket();
    (packet as any).decisions = 'not an array';
    const result = validateMemoryPacket(packet);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('decisions must be an array');
  });

  test('rejects empty id', () => {
    const packet = createValidPacket();
    packet.id = '';
    const result = validateMemoryPacket(packet);
    expect(result.valid).toBe(false);
  });
});

describe('Memory Packet Serialization', () => {
  test('serializes and deserializes round-trip', () => {
    const original = createValidPacket();
    const json = serializePacket(original);
    const restored = deserializePacket(json);
    expect(restored.id).toBe(original.id);
    expect(restored.decisions).toEqual(original.decisions);
    expect(restored.metadata.compression_ratio).toBe(original.metadata.compression_ratio);
  });

  test('serialize throws on invalid packet', () => {
    const invalid = { id: '' } as any;
    expect(() => serializePacket(invalid)).toThrow();
  });

  test('deserialize throws on malformed JSON', () => {
    expect(() => deserializePacket('not json')).toThrow('Invalid JSON string');
  });

  test('deserialize throws on valid JSON but invalid packet', () => {
    expect(() => deserializePacket('{"foo": "bar"}')).toThrow();
  });
});

describe('vote_receipts field', () => {
  test('accepts packet with valid vote_receipts array', () => {
    const packet = createValidPacket();
    const receipts: VoteReceipt[] = [
      { nk_id: 'nk_123', context_keys: ['jest'], succeeded: true, timestamp: new Date().toISOString() },
    ];
    packet.vote_receipts = receipts;
    const result = validateMemoryPacket(packet);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('accepts packet without vote_receipts', () => {
    const packet = createValidPacket();
    // vote_receipts is not set
    const result = validateMemoryPacket(packet);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('rejects non-array vote_receipts', () => {
    const packet = createValidPacket() as any;
    packet.vote_receipts = 'not an array';
    const result = validateMemoryPacket(packet);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('vote_receipts must be an array when present');
  });

  test('serializes and deserializes packet with vote_receipts', () => {
    const packet = createValidPacket();
    const receipts: VoteReceipt[] = [
      { nk_id: 'nk_456', context_keys: ['typescript', 'jest'], succeeded: false, timestamp: new Date().toISOString() },
    ];
    packet.vote_receipts = receipts;
    const json = serializePacket(packet);
    const restored = deserializePacket(json);
    expect(restored.vote_receipts).toEqual(receipts);
  });
});

describe('Transcript Compression', () => {
  test('compresses transcript to memory packet', () => {
    const transcript = [
      'Decision: Use TypeScript for the project',
      'Rejected using Python because team prefers TS',
      'Risk: The deadline is very tight',
      'TODO: Choose a database',
      'Created src/index.ts as entry point',
    ].join('\n');

    const packet = compressTranscript(transcript, 'session_123');
    expect(packet.session_id).toBe('session_123');
    expect(packet.decisions.length).toBeGreaterThan(0);
    expect(packet.rejected_ideas.length).toBeGreaterThan(0);
    expect(packet.risks.length).toBeGreaterThan(0);
    expect(packet.open_threads.length).toBeGreaterThan(0);
    expect(packet.key_file_changes.length).toBeGreaterThan(0);
    expect(packet.metadata.compression_ratio).toBeGreaterThan(0);
  });

  test('handles empty transcript', () => {
    const packet = compressTranscript('', 'session_empty');
    expect(packet.decisions).toHaveLength(0);
    expect(packet.summary).toBe('');
  });
});
