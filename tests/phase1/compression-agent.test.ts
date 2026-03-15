/**
 * Tests for the AI-Powered Compression Agent.
 * Uses a mock LLM provider to test parsing, validation, and error handling
 * without making real API calls.
 */

import { CompressionAgent } from '../../src/phase1/compression-agent';
import { LLMProvider } from '../../src/phase1/orchestrator';

const SAMPLE_TRANSCRIPT = `
User: We need to decide on the database for this project.
Assistant: I recommend SQLite for local storage with a markdown canonical layer on top.
User: What about PostgreSQL?
Assistant: Rejected - too heavy for this use case, requires a running server.
User: OK let's go with SQLite. What about the API layer?
Assistant: Decision: Use Express.js with TypeScript. Risk: We need to handle rate limiting for the LLM API calls or costs could spiral. TODO: implement the auth middleware, currently blocked on the OAuth provider decision.
User: Great. I've created src/db/sqlite-store.ts and modified src/index.ts.
`;

const VALID_LLM_RESPONSE = JSON.stringify({
  summary: "Decided to use SQLite with markdown canonical storage. Rejected PostgreSQL as too heavy. Chose Express.js + TypeScript for the API layer.",
  decisions: [
    { description: "Use SQLite for local storage", rationale: "Lightweight, no server required", timestamp: new Date().toISOString() },
    { description: "Use Express.js with TypeScript for API layer", rationale: "Familiar, typed, fast to set up", timestamp: new Date().toISOString() }
  ],
  rejected_ideas: [
    { idea: "PostgreSQL", reason: "Too heavy for this use case, requires a running server" }
  ],
  risks: [
    { description: "LLM API rate limiting needed or costs could spiral", severity: "high", mitigation: "Implement rate limiting middleware" }
  ],
  open_threads: [
    { topic: "Auth middleware implementation", status: "blocked", context: "Blocked on OAuth provider decision" }
  ],
  key_file_changes: [
    { path: "src/db/sqlite-store.ts", action: "created", summary: "New SQLite storage module" },
    { path: "src/index.ts", action: "modified", summary: "Updated to include new storage module" }
  ]
});

function makeMockProvider(response: string): LLMProvider {
  return { call: async (_prompt: string) => response };
}

describe('CompressionAgent', () => {
  describe('compress()', () => {
    it('returns a valid MemoryPacket from a well-formed LLM response', async () => {
      const agent = new CompressionAgent({
        provider: makeMockProvider(VALID_LLM_RESPONSE),
        sessionId: 'test-session-001',
      });

      const packet = await agent.compress(SAMPLE_TRANSCRIPT);

      expect(packet.session_id).toBe('test-session-001');
      expect(packet.id).toMatch(/^pkt_/);
      expect(packet.summary).toContain('SQLite');
      expect(packet.decisions).toHaveLength(2);
      expect(packet.rejected_ideas).toHaveLength(1);
      expect(packet.rejected_ideas[0].idea).toBe('PostgreSQL');
      expect(packet.risks).toHaveLength(1);
      expect(packet.risks[0].severity).toBe('high');
      expect(packet.open_threads).toHaveLength(1);
      expect(packet.open_threads[0].status).toBe('blocked');
      expect(packet.key_file_changes).toHaveLength(2);
    });

    it('populates metadata with compression ratio', async () => {
      const agent = new CompressionAgent({
        provider: makeMockProvider(VALID_LLM_RESPONSE),
        sessionId: 'test-session-002',
      });

      const packet = await agent.compress(SAMPLE_TRANSCRIPT);

      expect(packet.metadata.original_token_count).toBeGreaterThan(0);
      expect(packet.metadata.compressed_token_count).toBeGreaterThan(0);
      expect(packet.metadata.compression_ratio).toBeGreaterThan(0);
      expect(packet.metadata.fidelity_score).toBe(0.97);
    });

    it('strips markdown fences from LLM response before parsing', async () => {
      const wrappedResponse = `\`\`\`json\n${VALID_LLM_RESPONSE}\n\`\`\``;
      const agent = new CompressionAgent({
        provider: makeMockProvider(wrappedResponse),
        sessionId: 'test-session-003',
      });

      const packet = await agent.compress(SAMPLE_TRANSCRIPT);
      expect(packet.decisions).toHaveLength(2);
    });

    it('strips plain code fences from LLM response', async () => {
      const wrappedResponse = `\`\`\`\n${VALID_LLM_RESPONSE}\n\`\`\``;
      const agent = new CompressionAgent({
        provider: makeMockProvider(wrappedResponse),
        sessionId: 'test-session-004',
      });

      const packet = await agent.compress(SAMPLE_TRANSCRIPT);
      expect(packet.decisions).toHaveLength(2);
    });

    it('throws a clear error when LLM returns invalid JSON', async () => {
      const agent = new CompressionAgent({
        provider: makeMockProvider('Sorry, I cannot process this request.'),
        sessionId: 'test-session-005',
      });

      await expect(agent.compress(SAMPLE_TRANSCRIPT)).rejects.toThrow(
        'CompressionAgent: LLM returned invalid JSON'
      );
    });

    it('defaults empty arrays when fields are missing from LLM response', async () => {
      const minimalResponse = JSON.stringify({
        summary: 'Minimal session.',
        decisions: [],
        rejected_ideas: [],
        risks: [],
        open_threads: [],
        key_file_changes: [],
      });

      const agent = new CompressionAgent({
        provider: makeMockProvider(minimalResponse),
        sessionId: 'test-session-006',
      });

      const packet = await agent.compress(SAMPLE_TRANSCRIPT);
      expect(packet.decisions).toEqual([]);
      expect(packet.rejected_ideas).toEqual([]);
      expect(packet.risks).toEqual([]);
      expect(packet.open_threads).toEqual([]);
      expect(packet.key_file_changes).toEqual([]);
    });

    it('includes a prompt containing the transcript when calling the provider', async () => {
      let capturedPrompt = '';
      const provider: LLMProvider = {
        call: async (prompt: string) => {
          capturedPrompt = prompt;
          return VALID_LLM_RESPONSE;
        }
      };

      const agent = new CompressionAgent({ provider, sessionId: 'test-session-007' });
      await agent.compress(SAMPLE_TRANSCRIPT);

      expect(capturedPrompt).toContain('lossless compression agent');
      expect(capturedPrompt).toContain(SAMPLE_TRANSCRIPT);
    });
  });

  describe('compressToJson()', () => {
    it('returns a valid JSON string', async () => {
      const agent = new CompressionAgent({
        provider: makeMockProvider(VALID_LLM_RESPONSE),
        sessionId: 'test-session-008',
      });

      const json = await agent.compressToJson(SAMPLE_TRANSCRIPT);
      expect(() => JSON.parse(json)).not.toThrow();

      const parsed = JSON.parse(json);
      expect(parsed.session_id).toBe('test-session-008');
      expect(parsed.decisions).toHaveLength(2);
    });
  });
});
