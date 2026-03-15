/**
 * OpenAI Provider
 * Wraps the OpenAI SDK to satisfy the LLMProvider and LLMProviderConfig interfaces.
 * Supports GPT model tiers via a configurable model string.
 */

import OpenAI from 'openai';
import { LLMProvider } from '../phase1/orchestrator';
import { LLMProviderConfig } from '../phase3/consortium-voter';

export type OpenAIModel =
  | 'gpt-4o-mini'   // Fast, cheap — routine tasks
  | 'gpt-4o'        // Balanced — standard coding and reasoning
  | 'o1-preview';   // Deep reasoning — high-stakes decisions

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: OpenAIModel;
  private maxTokens: number;

  constructor(model: OpenAIModel = 'gpt-4o', maxTokens = 8096) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.model = model;
    this.maxTokens = maxTokens;
  }

  async call(prompt: string): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });

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
