/**
 * Model Router
 * Selects the appropriate model tier based on task complexity.
 * Keeps expensive models reserved for high-stakes decisions.
 *
 * Tiers:
 *   routine  — compression, tool selection, SOP routing
 *   standard — everyday coding, orchestrator tasks
 *   complex  — consortium voting, architectural decisions
 */

import { LLMProvider } from '../phase1/orchestrator';
import { ClaudeProvider } from './claude-provider';
import { GeminiProvider } from './gemini-provider';
import { OpenAIProvider } from './openai-provider';
import { ConsortiumVoter, ConsortiumConfig } from '../phase3/consortium-voter';

export type TaskComplexity = 'routine' | 'standard' | 'complex';

export interface ModelRouterConfig {
  /** Primary provider used for orchestrator and thread workers */
  primary: 'claude' | 'gemini' | 'openai';
  /** Whether to enable the full three-model consortium for complex tasks */
  enableConsortium: boolean;
}

export class ModelRouter {
  private claude: { routine: ClaudeProvider; standard: ClaudeProvider; complex: ClaudeProvider };
  private gemini: { routine: GeminiProvider; standard: GeminiProvider };
  private openai: { routine: OpenAIProvider; standard: OpenAIProvider; complex: OpenAIProvider };
  private config: ModelRouterConfig;

  constructor(config: ModelRouterConfig = { primary: 'claude', enableConsortium: true }) {
    this.config = config;

    this.claude = {
      routine:  new ClaudeProvider('claude-haiku-3-5-20241022'),
      standard: new ClaudeProvider('claude-3-5-sonnet-20241022'),
      complex:  new ClaudeProvider('claude-opus-4-5'),
    };

    this.gemini = {
      routine:  new GeminiProvider('gemini-1.5-flash'),
      standard: new GeminiProvider('gemini-1.5-pro'),
    };

    this.openai = {
      routine:  new OpenAIProvider('gpt-4o-mini'),
      standard: new OpenAIProvider('gpt-4o'),
      complex:  new OpenAIProvider('gpt-4o'),
    };
  }

  /**
   * Returns the best provider for a given complexity level.
   * Uses the configured primary provider.
   */
  getProvider(complexity: TaskComplexity): LLMProvider {
    switch (this.config.primary) {
      case 'gemini':
        return complexity === 'routine' ? this.gemini.routine : this.gemini.standard;
      case 'openai':
        return complexity === 'routine'
          ? this.openai.routine
          : complexity === 'standard'
          ? this.openai.standard
          : this.openai.complex;
      case 'claude':
      default:
        return complexity === 'routine'
          ? this.claude.routine
          : complexity === 'standard'
          ? this.claude.standard
          : this.claude.complex;
    }
  }

  /**
   * Returns a ConsortiumVoter with all three providers for complex validation tasks.
   * Claude Opus + Gemini Pro + GPT-4o in parallel.
   */
  getConsortiumVoter(config?: Partial<ConsortiumConfig>): ConsortiumVoter {
    if (!this.config.enableConsortium) {
      throw new Error('Consortium is disabled in ModelRouterConfig');
    }

    return new ConsortiumVoter({
      quorum_threshold: 0.6,
      similarity_threshold: 0.5,
      ...config,
      providers: [
        this.claude.complex.toConsortiumProvider(),
        this.gemini.standard.toConsortiumProvider(),
        this.openai.standard.toConsortiumProvider(),
      ],
    });
  }

  /** Convenience: provider for routine compression/tool-selection tasks */
  get routine(): LLMProvider { return this.getProvider('routine'); }

  /** Convenience: provider for standard orchestrator/coding tasks */
  get standard(): LLMProvider { return this.getProvider('standard'); }

  /** Convenience: provider for complex single-model reasoning */
  get complex(): LLMProvider { return this.getProvider('complex'); }
}
