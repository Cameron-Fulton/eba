/**
 * Gemini Provider
 * Wraps the Google Generative AI SDK to satisfy LLMProvider and LLMProviderConfig interfaces.
 * Supports Gemini model tiers via a configurable model string.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLMProvider } from '../phase1/orchestrator';
import { LLMProviderConfig } from '../phase3/consortium-voter';

export type GeminiModel =
  | 'gemini-3-flash-preview'  // Fast — routine/standard tasks
  | 'gemini-3.1-pro-preview'; // Most capable — complex tasks

export class GeminiProvider implements LLMProvider {
  private client: GoogleGenerativeAI;
  private model: GeminiModel;
  private timeoutMs: number;

  constructor(model: GeminiModel = 'gemini-3-flash-preview', timeoutMs = 60000) {
    if (!process.env.GOOGLE_API_KEY) {
      throw new Error('GOOGLE_API_KEY environment variable is not set');
    }
    this.client = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    this.model = model;
    this.timeoutMs = timeoutMs;
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('LLM call timed out after ' + ms + 'ms')), ms);
      promise.then(val => { clearTimeout(timer); resolve(val); }, err => { clearTimeout(timer); reject(err); });
    });
  }

  async call(prompt: string): Promise<string> {
    const generativeModel = this.client.getGenerativeModel({ model: this.model });
    const result = await this.withTimeout(generativeModel.generateContent(prompt), this.timeoutMs);
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
