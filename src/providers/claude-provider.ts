/**
 * Claude Provider
 * Wraps the Anthropic SDK to satisfy the LLMProvider and LLMProviderConfig interfaces.
 * Supports all Claude model tiers via a configurable model string.
 */

import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider, Message, LLMResponse, ToolCall } from '../phase1/orchestrator';
import { ToolSchema, ToolParameter } from '../phase2/tool-shed';
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

  constructor(model: ClaudeModel = 'claude-sonnet-4-6', maxTokens = 8192, timeoutMs = 180000) {
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

  async callWithTools(messages: Message[], tools: ToolSchema[]): Promise<LLMResponse> {
    // Convert our ToolSchema format to Anthropic's tool format
    const anthropicTools: Anthropic.Tool[] = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object' as const,
        properties: Object.fromEntries(
          t.parameters.map((p: ToolParameter) => [
            p.name,
            { type: p.type, description: p.description },
          ]),
        ),
        required: t.parameters.filter((p: ToolParameter) => p.required).map((p: ToolParameter) => p.name),
      },
    }));

    // Convert our Message format to Anthropic's format
    const anthropicMessages: Anthropic.MessageParam[] = messages
      .filter(m => m.role !== 'tool')
      .map(m => {
        if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
          return {
            role: 'assistant' as const,
            content: m.tool_calls.map(tc => ({
              type: 'tool_use' as const,
              id: tc.id,
              name: tc.name,
              input: tc.parameters,
            })),
          };
        }
        return { role: m.role as 'user' | 'assistant', content: m.content };
      });

    // Inject tool results as user messages (Anthropic requires tool results in user turn)
    const toolResultMessages = messages.filter(m => m.role === 'tool');
    for (const trMsg of toolResultMessages) {
      if (trMsg.tool_results && trMsg.tool_results.length > 0) {
        anthropicMessages.push({
          role: 'user' as const,
          content: trMsg.tool_results.map(tr => ({
            type: 'tool_result' as const,
            tool_use_id: tr.tool_call_id,
            content: tr.content,
            is_error: tr.is_error,
          })),
        });
      }
    }

    const response = await withTimeout(
      this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        tools: anthropicTools,
        messages: anthropicMessages,
      }),
      this.timeoutMs,
    );

    // If the model wants to call tools
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    if (toolUseBlocks.length > 0) {
      const toolCalls: ToolCall[] = toolUseBlocks.map(b => {
        if (b.type !== 'tool_use') throw new Error('unexpected block type');
        return {
          id: b.id,
          name: b.name,
          parameters: b.input as Record<string, unknown>,
        };
      });
      return { type: 'tool_calls', tool_calls: toolCalls };
    }

    // Text response — model is done
    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text or tool_use block in Anthropic response');
    }
    return { type: 'text', text: textBlock.text };
  }

  /** Returns a LLMProviderConfig for use in the ConsortiumVoter */
  toConsortiumProvider(): LLMProviderConfig {
    return {
      name: `claude:${this.model}`,
      call: (prompt: string) => this.call(prompt),
    };
  }
}
