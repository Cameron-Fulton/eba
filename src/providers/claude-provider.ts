/**
 * Claude Provider
 * Wraps the Anthropic SDK to satisfy the LLMProvider and LLMProviderConfig interfaces.
 * Supports all Claude model tiers via a configurable model string.
 */

import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider } from '../phase1/orchestrator';
import { LLMProviderConfig } from '../phase3/consortium-voter';

export type ClaudeModel =
  | 'claude-haiku-3-5-20241022'    // Fast, cheap — routine tasks
  | 'claude-3-5-sonnet-20241022'   // Balanced — standard coding
  | 'claude-opus-4-5';             // Most capable — high-stakes decisions

export class ClaudeProvider implements LLMProvider {
  private client: Anthropic;
  private model: ClaudeModel;
  private maxTokens: number;

  constructor(model: ClaudeModel = 'claude-3-5-sonnet-20241022', maxTokens = 8096) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.model = model;
    this.maxTokens = maxTokens;
  }

  async call(prompt: string): Promise<string> {
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });

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
