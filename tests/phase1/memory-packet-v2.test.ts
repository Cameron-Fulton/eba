/**
 * Tests for MemoryPacket v2 schema extensions.
 * Covers backward compat + new optional fields: entities, vocabulary, session_meta.
 */

import {
  validateMemoryPacket,
  serializePacket,
  deserializePacket,
  MemoryPacket,
  Entity,
  VocabularyEntry,
  SessionMeta,
} from '../../src/phase1/memory-packet';

// Minimal valid v1 packet — used as baseline throughout
const V1_PACKET: MemoryPacket = {
  id: 'pkt_test_001',
  timestamp: '2026-03-21T00:00:00.000Z',
  session_id: 'sess_001',
  decisions: [],
  rejected_ideas: [],
  risks: [],
  open_threads: [],
  key_file_changes: [],
  summary: 'baseline v1 packet',
  metadata: {
    original_token_count: 100,
    compressed_token_count: 33,
    compression_ratio: 3.03,
    fidelity_score: 0.97,
  },
};

describe('MemoryPacket v2 — backward compatibility', () => {
  it('validates a v1 packet (no new fields) without errors', () => {
    const result = validateMemoryPacket(V1_PACKET);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('round-trips a v1 packet through serialize/deserialize unchanged', () => {
    const json = serializePacket(V1_PACKET);
    const restored = deserializePacket(json);
    expect(restored).toEqual(V1_PACKET);
  });
});

describe('MemoryPacket v2 — entities field', () => {
  it('validates a packet with a well-formed entities array', () => {
    const entities: Entity[] = [
      { name: 'Anthropic', relationship: 'provider', urls: ['https://anthropic.com'], also: ['Claude'] },
    ];
    const result = validateMemoryPacket({ ...V1_PACKET, entities });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates a packet with an empty entities array', () => {
    const result = validateMemoryPacket({ ...V1_PACKET, entities: [] });
    expect(result.valid).toBe(true);
  });

  it('rejects entities that is not an array', () => {
    const result = validateMemoryPacket({ ...V1_PACKET, entities: 'not-an-array' as unknown });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('entities must be an array when present');
  });

  it('rejects entities that is an object (not array)', () => {
    const result = validateMemoryPacket({ ...V1_PACKET, entities: { name: 'bad' } as unknown });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('entities must be an array when present');
  });

  it('accepts packet when entities is undefined (field present but undefined)', () => {
    const result = validateMemoryPacket({ ...V1_PACKET, entities: undefined });
    expect(result.valid).toBe(true);
  });
});

describe('MemoryPacket v2 — vocabulary field', () => {
  it('validates a packet with a well-formed vocabulary array', () => {
    const vocabulary: VocabularyEntry[] = [
      { term: 'EBA', definition: 'Episodic Blueprint Architecture', context: 'project name' },
    ];
    const result = validateMemoryPacket({ ...V1_PACKET, vocabulary });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates a packet with a vocabulary entry missing optional context', () => {
    const vocabulary: VocabularyEntry[] = [
      { term: 'NK', definition: 'Negative Knowledge' },
    ];
    const result = validateMemoryPacket({ ...V1_PACKET, vocabulary });
    expect(result.valid).toBe(true);
  });

  it('validates a packet with an empty vocabulary array', () => {
    const result = validateMemoryPacket({ ...V1_PACKET, vocabulary: [] });
    expect(result.valid).toBe(true);
  });

  it('rejects vocabulary that is not an array', () => {
    const result = validateMemoryPacket({ ...V1_PACKET, vocabulary: 'not-an-array' as unknown });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('vocabulary must be an array when present');
  });

  it('rejects vocabulary that is a number', () => {
    const result = validateMemoryPacket({ ...V1_PACKET, vocabulary: 42 as unknown });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('vocabulary must be an array when present');
  });

  it('accepts packet when vocabulary is undefined', () => {
    const result = validateMemoryPacket({ ...V1_PACKET, vocabulary: undefined });
    expect(result.valid).toBe(true);
  });
});

describe('MemoryPacket v2 — session_meta field', () => {
  it('validates a packet with a well-formed session_meta object', () => {
    const session_meta: SessionMeta = {
      token_budget_rationale: 'Kept short to leave room for context injection',
      load_bearing_sections: ['decisions', 'open_threads'],
    };
    const result = validateMemoryPacket({ ...V1_PACKET, session_meta });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates a packet with an empty session_meta object', () => {
    const result = validateMemoryPacket({ ...V1_PACKET, session_meta: {} });
    expect(result.valid).toBe(true);
  });

  it('validates a packet with session_meta containing only token_budget_rationale', () => {
    const session_meta: SessionMeta = { token_budget_rationale: 'minimal footprint' };
    const result = validateMemoryPacket({ ...V1_PACKET, session_meta });
    expect(result.valid).toBe(true);
  });

  it('rejects session_meta that is a string', () => {
    const result = validateMemoryPacket({ ...V1_PACKET, session_meta: 'not-an-object' as unknown });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('session_meta must be an object when present');
  });

  it('rejects session_meta that is an array', () => {
    const result = validateMemoryPacket({ ...V1_PACKET, session_meta: [] as unknown });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('session_meta must be an object when present');
  });

  it('rejects session_meta that is null', () => {
    // null is explicitly excluded — "object when present" means non-null object
    const result = validateMemoryPacket({ ...V1_PACKET, session_meta: null as unknown });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('session_meta must be an object when present');
  });

  it('accepts packet when session_meta is undefined', () => {
    const result = validateMemoryPacket({ ...V1_PACKET, session_meta: undefined });
    expect(result.valid).toBe(true);
  });
});

describe('MemoryPacket v2 — full v2 round-trip', () => {
  it('serializes and deserializes a complete v2 packet preserving all fields', () => {
    const v2Packet: MemoryPacket = {
      ...V1_PACKET,
      entities: [
        {
          name: 'OpenRouter',
          relationship: 'model-provider',
          urls: ['https://openrouter.ai'],
          also: ['OR', 'openrouter'],
        },
      ],
      vocabulary: [
        { term: 'SOP', definition: 'Standard Operating Procedure', context: 'phase2' },
        { term: '3PM', definition: 'Three-Pillar Model' },
      ],
      session_meta: {
        token_budget_rationale: 'Compressed aggressively — 5 decisions, 2 open threads',
        load_bearing_sections: ['decisions', 'key_file_changes'],
      },
    };

    const json = serializePacket(v2Packet);
    const restored = deserializePacket(json);

    expect(restored).toEqual(v2Packet);
    expect(restored.entities).toHaveLength(1);
    expect(restored.entities![0].name).toBe('OpenRouter');
    expect(restored.vocabulary).toHaveLength(2);
    expect(restored.vocabulary![0].term).toBe('SOP');
    expect(restored.session_meta?.token_budget_rationale).toContain('Compressed');
    expect(restored.session_meta?.load_bearing_sections).toContain('decisions');
  });
});
