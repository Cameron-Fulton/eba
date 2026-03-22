/**
 * OpenRouter Provider
 * Wraps the OpenAI SDK (OpenAI-compatible API) to satisfy the
 * LLMProvider and LLMProviderConfig interfaces.
 */

import OpenAI, { APIError } from 'openai';
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import { LLMProvider, Message, LLMResponse, ToolCall } from '../phase1/orchestrator';
import { ToolSchema, ToolParameter } from '../phase2/tool-shed';
import { LLMProviderConfig } from '../phase3/consortium-voter';
import { withTimeout } from './utils';

/**
 * OpenRouter supports dynamic model IDs (including provider routing suffixes
 * like :free or :floor), so we keep this type freeform.
 */
export type OpenRouterModel = string;

/** Shape of the usage object returned by OpenRouter (extends the standard OpenAI usage). */
interface OpenRouterUsage {
  cost?: number;
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
}

/** Typed alias for the OpenRouter chat completion request payload. */
type OpenRouterRequest = ChatCompletionCreateParamsNonStreaming;

export class OpenRouterProvider implements LLMProvider {
  private readonly client: OpenAI;
  private readonly model: OpenRouterModel;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;

  constructor(model: OpenRouterModel, maxTokens = 8192, timeoutMs = 180000) {
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

  getModel(): OpenRouterModel { return this.model; }
  getMaxTokens(): number { return this.maxTokens; }
  getTimeoutMs(): number { return this.timeoutMs; }

  async call(prompt: string): Promise<string> {
    const request: OpenRouterRequest = {
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

    const usage = (completion as ChatCompletion & { usage?: OpenRouterUsage }).usage;
    if (usage?.cost !== undefined) {
      const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? 0;
      console.log(`[OpenRouter] cost=$${usage.cost} reasoning_tokens=${reasoningTokens}`);
    }

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('OpenRouter returned an empty response');
    }
    return content;
  }

  async callWithTools(messages: Message[], tools: ToolSchema[]): Promise<LLMResponse> {
    const openAITools = tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object' as const,
          properties: Object.fromEntries(
            tool.parameters.map((p: ToolParameter) => [
              p.name,
              { type: p.type, description: p.description },
            ]),
          ),
          required: tool.parameters.filter((p: ToolParameter) => p.required).map((p: ToolParameter) => p.name),
        },
      },
    }));

    const openAIMessages: ChatCompletionCreateParamsNonStreaming['messages'] = [];

    for (const message of messages) {
      if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
        openAIMessages.push({
          role: 'assistant',
          content: null,
          tool_calls: message.tool_calls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.parameters),
            },
          })),
        });
        continue;
      }

      if (message.role === 'tool') {
        if (message.tool_results && message.tool_results.length > 0) {
          for (const tr of message.tool_results) {
            openAIMessages.push({
              role: 'tool',
              tool_call_id: tr.tool_call_id,
              content: tr.content,
            });
          }
        }
        continue;
      }

      openAIMessages.push({ role: message.role, content: message.content });
    }

    const request: OpenRouterRequest = {
      model: this.model,
      messages: openAIMessages,
      stream: false as const,
      max_tokens: this.maxTokens,
      tools: openAITools,
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

    const usage = (completion as ChatCompletion & { usage?: OpenRouterUsage }).usage;
    if (usage?.cost !== undefined) {
      const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? 0;
      console.log(`[OpenRouter] cost=$${usage.cost} reasoning_tokens=${reasoningTokens}`);
    }

    const choice = completion.choices[0];
    if (!choice) {
      throw new Error('OpenRouter returned an empty response');
    }

    if (choice.finish_reason === 'tool_calls') {
      const messageToolCalls = choice.message.tool_calls;
      if (!messageToolCalls || messageToolCalls.length === 0) {
        throw new Error('OpenRouter returned tool_calls finish_reason without tool calls');
      }

      const toolCalls: ToolCall[] = [];

      for (const tc of messageToolCalls) {
        if (tc.type !== 'function') {
          continue;
        }

        const args = tc.function.arguments || '{}';
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(args) as Record<string, unknown>;
        } catch {
          parsed = {};
        }

        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          parameters: parsed,
        });
      }

      return { type: 'tool_calls', tool_calls: toolCalls };
    }

    const content = choice.message.content;
    if (!content) {
      throw new Error('OpenRouter returned an empty response');
    }

    return { type: 'text', text: content };
  }

  /** Returns a LLMProviderConfig for use in the ConsortiumVoter */
  toConsortiumProvider(): LLMProviderConfig {
    return {
      name: `openrouter:${this.model}`,
      call: (prompt: string) => this.call(prompt),
    };
  }
}
