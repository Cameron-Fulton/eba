/**
 * OpenAI Provider
 * Wraps the OpenAI SDK to satisfy the LLMProvider and LLMProviderConfig interfaces.
 * Supports GPT model tiers via a configurable model string.
 */

import OpenAI from 'openai';
import { LLMProvider, Message, LLMResponse, ToolCall } from '../phase1/orchestrator';
import { ToolSchema } from '../phase2/tool-shed';
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

  constructor(model: OpenAIModel = 'gpt-5.4', maxTokens = 8192, timeoutMs = 180000) {
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

  async callWithTools(messages: Message[], tools: ToolSchema[]): Promise<LLMResponse> {
    const openAITools = tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object' as const,
          properties: Object.fromEntries(
            t.parameters.map(p => [
              p.name,
              { type: p.type, description: p.description },
            ]),
          ),
          required: t.parameters.filter(p => p.required).map(p => p.name),
        },
      },
    }));

    const openAIMessages: Parameters<typeof this.client.chat.completions.create>[0]['messages'] = [];

    for (const message of messages) {
      if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
        openAIMessages.push({
          role: 'assistant',
          content: null,
          tool_calls: message.tool_calls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.parameters),
            },
          })),
        });
        continue;
      }

      if (message.role === 'tool') {
        for (const result of message.tool_results ?? []) {
          openAIMessages.push({
            role: 'tool',
            tool_call_id: result.tool_call_id,
            content: result.content,
          });
        }
        continue;
      }

      openAIMessages.push({
        role: message.role,
        content: message.content,
      });
    }

    const request: Parameters<typeof this.client.chat.completions.create>[0] = {
      model: this.model,
      messages: openAIMessages,
      tools: openAITools,
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

    const choice = completion.choices[0];
    if (!choice?.message) {
      throw new Error('OpenAI returned no message in completion choice');
    }

    if (choice.finish_reason === 'tool_calls') {
      const responseToolCalls = choice.message.tool_calls ?? [];
      const toolCalls: ToolCall[] = [];

      for (const tc of responseToolCalls) {
        if (tc.type !== 'function') {
          continue;
        }

        let parameters: Record<string, unknown> = {};
        try {
          parameters = tc.function.arguments ? JSON.parse(tc.function.arguments) as Record<string, unknown> : {};
        } catch {
          throw new Error(`OpenAI returned invalid JSON arguments for tool call: ${tc.function.name}`);
        }

        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          parameters,
        });
      }

      return { type: 'tool_calls', tool_calls: toolCalls };
    }

    const content = choice.message.content;
    if (!content) {
      throw new Error('OpenAI returned an empty response');
    }

    return { type: 'text', text: content };
  }

  /** Returns a LLMProviderConfig for use in the ConsortiumVoter */
  toConsortiumProvider(): LLMProviderConfig {
    return {
      name: `openai:${this.model}`,
      call: (prompt: string) => this.call(prompt),
    };
  }
}
