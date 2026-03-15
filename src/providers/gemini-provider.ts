/**
 * Gemini Provider
 * Wraps the Google Generative AI SDK to satisfy LLMProvider and LLMProviderConfig interfaces.
 * Supports Gemini model tiers via a configurable model string.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLMProvider } from '../phase1/orchestrator';
import { LLMProviderConfig } from '../phase3/consortium-voter';

export type GeminiModel =
  | 'gemini-1.5-flash'   // Fast, cheap — routine tasks
  | 'gemini-1.5-pro'     // Balanced — standard coding
  | 'gemini-2.0-flash';  // Latest flash — fast reasoning

export class GeminiProvider implements LLMProvider {
  private client: GoogleGenerativeAI;
  private model: GeminiModel;

  constructor(model: GeminiModel = 'gemini-1.5-pro') {
    if (!process.env.GOOGLE_API_KEY) {
      throw new Error('GOOGLE_API_KEY environment variable is not set');
    }
    this.client = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    this.model = model;
  }

  async call(prompt: string): Promise<string> {
    const generativeModel = this.client.getGenerativeModel({ model: this.model });
    const result = await generativeModel.generateContent(prompt);
    const response = result.response;
    return response.text();
  }

  /** Returns a LLMProviderConfig for use in the ConsortiumVoter */
  toConsortiumProvider(): LLMProviderConfig {
    return {
      name: `gemini:${this.model}`,
      call: (prompt: string) => this.call(prompt),
    };
  }
}
