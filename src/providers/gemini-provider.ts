/**
 * Gemini Provider
 * Wraps the Google Generative AI SDK to satisfy LLMProvider and LLMProviderConfig interfaces.
 * Supports Gemini model tiers via a configurable model string.
 */

import * as crypto from 'crypto';
import { GoogleGenerativeAI, FunctionCallingMode, SchemaType, Content, FunctionDeclarationSchemaProperty } from '@google/generative-ai';
import type { FunctionDeclaration } from '@google/generative-ai';
import { LLMProvider, Message, LLMResponse, ToolCall } from '../phase1/orchestrator';
import { ToolSchema, ToolParameter } from '../phase2/tool-shed';
import { LLMProviderConfig } from '../phase3/consortium-voter';
import { withTimeout } from './utils';

export type GeminiModel =
  | 'gemini-3-flash-preview'  // Fast — routine/standard tasks
  | 'gemini-3.1-pro-preview'; // Most capable — complex tasks

export class GeminiProvider implements LLMProvider {
  private client: GoogleGenerativeAI;
  private model: GeminiModel;
  private timeoutMs: number;

  constructor(model: GeminiModel = 'gemini-3-flash-preview', timeoutMs = 180000) {
    if (!process.env.GOOGLE_API_KEY) {
      throw new Error('GOOGLE_API_KEY environment variable is not set');
    }
    this.client = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    this.model = model;
    this.timeoutMs = timeoutMs;
  }

  async call(prompt: string): Promise<string> {
    const generativeModel = this.client.getGenerativeModel({ model: this.model });
    const result = await withTimeout(generativeModel.generateContent(prompt), this.timeoutMs);
    const response = result.response;
    return response.text();
  }

  async callWithTools(messages: Message[], tools: ToolSchema[]): Promise<LLMResponse> {
    // Map ToolParameter.type string to a typed Schema object
    const toSchemaProperty = (p: ToolParameter): FunctionDeclarationSchemaProperty => {
      return { type: p.type as SchemaType, description: p.description } as FunctionDeclarationSchemaProperty;
    };

    // Convert ToolSchema[] to Gemini FunctionDeclaration[]
    const functionDeclarations: FunctionDeclaration[] = tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: SchemaType.OBJECT,
        properties: Object.fromEntries(
          t.parameters.map((p: ToolParameter) => [p.name, toSchemaProperty(p)]),
        ),
        required: t.parameters.filter((p: ToolParameter) => p.required).map((p: ToolParameter) => p.name),
      },
    }));

    // Build a map from tool_call_id -> function name for resolving functionResponse.name
    // (Gemini API requires the function name, not the call ID)
    const callIdToFnName = new Map<string, string>();

    // Convert Message[] to Gemini Content[]
    const contents: Content[] = [];
    for (const msg of messages) {
      if (msg.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: msg.content }] });
      } else if (msg.role === 'assistant') {
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            callIdToFnName.set(tc.id, tc.name);
          }
          contents.push({
            role: 'model',
            parts: msg.tool_calls.map(tc => ({
              functionCall: { name: tc.name, args: tc.parameters },
            })),
          });
        } else {
          contents.push({ role: 'model', parts: [{ text: msg.content }] });
        }
      } else if (msg.role === 'tool' && msg.tool_results) {
        contents.push({
          role: 'function',
          parts: msg.tool_results.map(tr => ({
            functionResponse: {
              name: callIdToFnName.get(tr.tool_call_id) ?? tr.tool_call_id,
              response: { content: tr.content, is_error: tr.is_error },
            },
          })),
        });
      }
    }

    const generativeModel = this.client.getGenerativeModel({ model: this.model });
    const result = await withTimeout(
      generativeModel.generateContent({
        contents,
        tools: [{ functionDeclarations }],
        toolConfig: { functionCallingConfig: { mode: FunctionCallingMode.AUTO } },
      }),
      this.timeoutMs,
    );

    const response = result.response;
    const functionCalls = response.functionCalls();

    if (functionCalls && functionCalls.length > 0) {
      const toolCalls: ToolCall[] = functionCalls.map((fc, i) => ({
        id: crypto.randomUUID(),
        name: fc.name,
        parameters: (fc.args ?? {}) as Record<string, unknown>,
      }));
      return { type: 'tool_calls', tool_calls: toolCalls };
    }

    return { type: 'text', text: response.text() };
  }

  /** Returns a LLMProviderConfig for use in the ConsortiumVoter */
  toConsortiumProvider(): LLMProviderConfig {
    return {
      name: `gemini:${this.model}`,
      call: (prompt: string) => this.call(prompt),
    };
  }
}
