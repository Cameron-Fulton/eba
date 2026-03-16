/**
 * OpenRouter Provider
 * Wraps the OpenAI SDK (OpenAI-compatible API) to satisfy the
 * LLMProvider and LLMProviderConfig interfaces.
 */

import OpenAI, { APIError } from 'openai';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import { LLMProvider } from '../phase1/orchestrator';
import { LLMProviderConfig } from '../phase3/consortium-voter';
import { withTimeout } from './utils';

/**
 * OpenRouter supports dynamic model IDs (including provider routing suffixes
 * like :free or :floor), so we keep this type freeform.
 */
export type OpenRouterModel = string;

export class OpenRouterProvider implements LLMProvider {
  private client: OpenAI;
  private model: OpenRouterModel;
  private maxTokens: number;
  private timeoutMs: number;

  constructor(model: OpenRouterModel, maxTokens = 8192, timeoutMs = 60000) {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error('OPENROUTER_API_KEY environment variable is not set');
    }

    this.client = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/eba-project',
        'X-OpenRouter-Title': 'EBA',
      },
    });

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

    let completion: ChatCompletion;
    try {
      completion = await withTimeout(
        this.client.chat.completions.create(request),
        this.timeoutMs,
      ) as ChatCompletion;
    } catch (error: unknown) {
      if (error instanceof APIError && error.status === 502 && /Provider returned error/i.test(error.message ?? '')) {
        throw new Error('OpenRouter upstream failure (retryable): Provider returned error (502)');
      }
      throw error;
    }

    const usage = (completion as any).usage;
    if (usage?.cost !== undefined) {
      console.log('[OpenRouter] cost=$' + usage.cost + ' reasoning_tokens=' + (usage?.completion_tokens_details?.reasoning_tokens ?? 0));
    }

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('OpenRouter returned an empty response');
    }
    return content;
  }

  /** Returns a LLMProviderConfig for use in the ConsortiumVoter */
  toConsortiumProvider(): LLMProviderConfig {
    return {
      name: `openrouter:${this.model}`,
      call: (prompt: string) => this.call(prompt),
    };
  }
}
