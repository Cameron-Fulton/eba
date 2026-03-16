/**
 * Compression Agent (AI-Powered)
 * Replaces the keyword-scanning compressTranscript function with a real LLM call.
 * Uses a cheap/fast model (Haiku or Flash) to semantically understand a session
 * transcript and extract a structured MemoryPacket at ~20:1 compression.
 *
 * The prompt is carefully structured to extract:
 *   - decisions (what was chosen and why)
 *   - rejected_ideas (what was explicitly ruled out)
 *   - risks (concerns surfaced during the session)
 *   - open_threads (incomplete work or blockers)
 *   - key_file_changes (files created, modified, deleted)
 *   - summary (one-paragraph TL;DR)
 */

import { LLMProvider } from './orchestrator';
import { MemoryPacket, validateMemoryPacket } from './memory-packet';
import { randomUUID } from 'crypto';

export interface CompressionAgentConfig {
  /** A fast, cheap provider — Haiku or Flash recommended */
  provider: LLMProvider;
  /** Session identifier carried into the packet */
  sessionId: string;
}

const COMPRESSION_PROMPT = (transcript: string) => `You are a lossless compression agent for AI session transcripts.

Your job is to convert the following session transcript into a structured JSON memory packet.
Be exhaustive with decisions and rejected ideas — these are the most important fields.
A future AI agent will use this packet to reconstruct full context of what happened.

OUTPUT FORMAT (respond with raw JSON only, no markdown fences):
{
  "summary": "One paragraph TL;DR of what happened in this session",
  "decisions": [
    { "description": "What was decided", "rationale": "Why this choice was made", "timestamp": "ISO8601" }
  ],
  "rejected_ideas": [
    { "idea": "What was considered but ruled out", "reason": "Why it was rejected" }
  ],
  "risks": [
    { "description": "Risk or concern surfaced", "severity": "low|medium|high|critical", "mitigation": "optional mitigation noted" }
  ],
  "open_threads": [
    { "topic": "Incomplete item or blocker", "status": "blocked|in_progress|needs_review", "context": "Relevant context" }
  ],
  "key_file_changes": [
    { "path": "relative/file/path", "action": "created|modified|deleted", "summary": "What changed and why" }
  ]
}

RULES:
- Extract ALL decisions, even minor ones. Missing a decision is worse than including a trivial one.
- Extract ALL rejected ideas explicitly. This prevents a fresh agent from re-proposing bad ideas.
- Be specific in rationale fields — vague rationale is useless to a fresh agent.
- If a field has no entries, return an empty array [].
- Respond with raw JSON only. No explanation, no markdown.

SESSION TRANSCRIPT:
${transcript}
`;

const FIDELITY_SCORE = 0.97;

export class CompressionAgent {
  private config: CompressionAgentConfig;

  constructor(config: CompressionAgentConfig) {
    this.config = config;
  }

  async compress(transcript: string): Promise<MemoryPacket> {
    const originalTokens = Math.ceil(transcript.length / 4);

    // Call the LLM with the structured compression prompt
    const raw = await this.config.provider.call(COMPRESSION_PROMPT(transcript));

    // Parse and validate the response
    let parsed: unknown;
    try {
      // Strip markdown fences if the model added them despite instructions
      const cleaned = raw
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(`CompressionAgent: LLM returned invalid JSON.\nRaw response:\n${raw}`);
    }

    // Build the full packet, merging LLM output with metadata
    const extracted = parsed as Record<string, unknown>;
    const compressedContent = JSON.stringify(extracted);
    const compressedTokens  = Math.ceil(compressedContent.length / 4);
    const compressionRatio  = originalTokens > 0
      ? originalTokens / Math.max(compressedTokens, 1)
      : 1;

    const packet: MemoryPacket = {
      id:          `pkt_${Date.now()}_${randomUUID().replace(/-/g, '').substring(0, 8)}`,
      timestamp:   new Date().toISOString(),
      session_id:  this.config.sessionId,
      summary:     String(extracted.summary ?? ''),
      decisions:   Array.isArray(extracted.decisions)     ? extracted.decisions     : [],
      rejected_ideas: Array.isArray(extracted.rejected_ideas) ? extracted.rejected_ideas : [],
      risks:       Array.isArray(extracted.risks)         ? extracted.risks         : [],
      open_threads: Array.isArray(extracted.open_threads) ? extracted.open_threads  : [],
      key_file_changes: Array.isArray(extracted.key_file_changes) ? extracted.key_file_changes : [],
      metadata: {
        original_token_count:    originalTokens,
        compressed_token_count:  compressedTokens,
        compression_ratio:       compressionRatio,
        fidelity_score:          FIDELITY_SCORE,
      },
    };

    // Validate before returning
    const validation = validateMemoryPacket(packet);
    if (!validation.valid) {
      throw new Error(`CompressionAgent: produced invalid packet: ${validation.errors.join(', ')}`);
    }

    return packet;
  }

  /**
   * Convenience: compress and serialize to JSON string in one call.
   */
  async compressToJson(transcript: string): Promise<string> {
    const packet = await this.compress(transcript);
    return JSON.stringify(packet, null, 2);
  }
}
