/**
 * OpenAI Provider
 * Wraps the OpenAI SDK to satisfy the LLMProvider and LLMProviderConfig interfaces.
 * Supports GPT model tiers via a configurable model string.
 */

import OpenAI from 'openai';
import { LLMProvider } from '../phase1/orchestrator';
import { LLMProviderConfig } from '../phase3/consortium-voter';
import { withTimeout } from './utils';

export type OpenAIModel =
  | 'gpt-5-mini'     // Fast, cheap — routine tasks
  | 'gpt-5.4'        // Balanced — standard coding and reasoning
  | 'o3';            // Coding/agentic reasoning model
export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: OpenAIModel;
  private maxTokens: number;
  private timeoutMs: number;

  constructor(model: OpenAIModel = 'gpt-5.4', maxTokens = 8192, timeoutMs = 60000) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.model = model;
    this.maxTokens = maxTokens;
    this.timeoutMs = timeoutMs;
  }

  async call(prompt: string): Promise<string> {
    const request: Parameters<typeof this.client.chat.completions.create>[0] = {
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      stream: false as const,
      max_tokens: this.maxTokens,
    };

    const completion = await withTimeout(
      this.client.chat.completions.create(request),
      this.timeoutMs,
    );

    if (!completion || !('choices' in completion)) {
      throw new Error('OpenAI returned an unexpected response format');
    }

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI returned an empty response');
    }
    return content;
  }

  /** Returns a LLMProviderConfig for use in the ConsortiumVoter */
  toConsortiumProvider(): LLMProviderConfig {
    return {
      name: `openai:${this.model}`,
      call: (prompt: string) => this.call(prompt),
    };
  }
}
