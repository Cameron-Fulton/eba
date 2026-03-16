/**
 * Claude Provider
 * Wraps the Anthropic SDK to satisfy the LLMProvider and LLMProviderConfig interfaces.
 * Supports all Claude model tiers via a configurable model string.
 */

import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider } from '../phase1/orchestrator';
import { LLMProviderConfig } from '../phase3/consortium-voter';
import { withTimeout } from './utils';

export type ClaudeModel =
  | 'claude-haiku-4-5'    // Fast, cheap — routine tasks
  | 'claude-sonnet-4-6'   // Balanced — standard coding
  | 'claude-opus-4-6';    // Most capable — high-stakes decisions

export class ClaudeProvider implements LLMProvider {
  private client: Anthropic;
  private model: ClaudeModel;
  private maxTokens: number;
  private timeoutMs: number;

  constructor(model: ClaudeModel = 'claude-sonnet-4-6', maxTokens = 8192, timeoutMs = 60000) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.model = model;
    this.maxTokens = maxTokens;
    this.timeoutMs = timeoutMs;
  }

  async call(prompt: string): Promise<string> {
    const message = await withTimeout(
      this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
      this.timeoutMs,
    );

    const block = message.content[0];
    if (block.type !== 'text') {
      throw new Error(`Unexpected content block type: ${block.type}`);
    }
    return block.text;
  }

  /** Returns a LLMProviderConfig for use in the ConsortiumVoter */
  toConsortiumProvider(): LLMProviderConfig {
    return {
      name: `claude:${this.model}`,
      call: (prompt: string) => this.call(prompt),
    };
  }
}
