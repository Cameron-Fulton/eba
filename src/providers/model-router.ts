/**
 * Model Router
 * Selects the appropriate model tier based on task complexity.
 * Keeps expensive models reserved for high-stakes decisions.
 *
 * Tiers (Claude defaults):
 *   routine  — compression, tool selection, SOP routing
 *              → claude-haiku-4-5 (Fast, cheap — routine tasks)
 *   standard — everyday coding, orchestrator tasks
 *              → claude-sonnet-4-6 (Balanced — standard coding)
 *   complex  — consortium voting, architectural decisions
 *              → claude-opus-4-6 (Most capable — high-stakes decisions)
 */

import * as fs from 'fs';
import * as path from 'path';
import { LLMProvider } from '../phase1/orchestrator';
import { ClaudeProvider } from './claude-provider';
import { GeminiProvider } from './gemini-provider';
import { OpenAIProvider } from './openai-provider';
import { OpenRouterProvider } from './openrouter-provider';
import { ConsortiumVoter, ConsortiumConfig } from '../phase3/consortium-voter';

export type TaskComplexity = 'routine' | 'standard' | 'complex';

export interface ModelRouterConfig {
  /** Primary provider used for orchestrator and thread workers */
  primary: 'claude' | 'gemini' | 'openai' | 'openrouter';
  /** Whether to enable the full three-model consortium for complex tasks */
  enableConsortium: boolean;
}

interface OpenRouterTierConfig {
  routine: string;
  standard: string;
  complex: string;
}

interface OpenRouterConfigFile {
  updated_at?: string;
  interval_hours?: number;
  openrouter?: Partial<OpenRouterTierConfig>;
}

const MODEL_CONFIG_PATH = path.resolve(__dirname, 'model-config.json');

const DEFAULT_OPENROUTER_MODELS: OpenRouterTierConfig = {
  routine: 'qwen/qwen3-coder',
  standard: 'minimax/minimax-m2.5',
  complex: 'moonshotai/kimi-k2-thinking',
};

export class ModelRouter {
  private static instances = new Set<ModelRouter>();

  private claude: { routine: ClaudeProvider; standard: ClaudeProvider; complex: ClaudeProvider };
  private gemini: { routine: GeminiProvider; standard: GeminiProvider; complex: GeminiProvider };
  private openai: { routine: OpenAIProvider; standard: OpenAIProvider; complex: OpenAIProvider };
  private openrouter: { routine: OpenRouterProvider; standard: OpenRouterProvider; complex: OpenRouterProvider };
  private config: ModelRouterConfig;

  constructor(config: ModelRouterConfig = { primary: 'claude', enableConsortium: true }) {
    this.config = config;

    this.claude = {
      routine: new ClaudeProvider('claude-haiku-4-5'),
      standard: new ClaudeProvider('claude-sonnet-4-6'),
      complex: new ClaudeProvider('claude-opus-4-6'),
    };

    this.gemini = {
      routine: new GeminiProvider('gemini-3-flash-preview'),
      standard: new GeminiProvider('gemini-3.1-pro-preview'),
      complex: new GeminiProvider('gemini-3.1-pro-preview'),
    };

    this.openai = {
      routine: new OpenAIProvider('gpt-5-mini'),
      standard: new OpenAIProvider('gpt-5'),
      complex: new OpenAIProvider('o3'),
    };

    this.openrouter = this.buildOpenRouterProviders(ModelRouter.loadOpenRouterTierConfig());
    ModelRouter.instances.add(this);
  }

  /**
   * Re-read model-config.json and update OpenRouter tier assignments on all active router instances.
   */
  static reloadOpenRouterModels(): void {
    const tierConfig = ModelRouter.loadOpenRouterTierConfig();

    for (const router of ModelRouter.instances) {
      router.openrouter = router.buildOpenRouterProviders(tierConfig);
    }

    console.log(
      `[ModelRouter] OpenRouter models reloaded: routine=${tierConfig.routine}, standard=${tierConfig.standard}, complex=${tierConfig.complex}`,
    );
  }

  private static loadOpenRouterTierConfig(): OpenRouterTierConfig {
    let raw: string;
    try {
      raw = fs.readFileSync(MODEL_CONFIG_PATH, 'utf-8');
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        console.warn('[ModelRouter] model-config.json not found, using defaults.');
      } else {
        console.warn('[ModelRouter] Failed to read model-config.json, using defaults.', error);
      }
      return { ...DEFAULT_OPENROUTER_MODELS };
    }

    try {
      const parsed = JSON.parse(raw) as OpenRouterConfigFile;

      return {
        routine: parsed.openrouter?.routine ?? DEFAULT_OPENROUTER_MODELS.routine,
        standard: parsed.openrouter?.standard ?? DEFAULT_OPENROUTER_MODELS.standard,
        complex: parsed.openrouter?.complex ?? DEFAULT_OPENROUTER_MODELS.complex,
      };
    } catch (error) {
      console.warn('[ModelRouter] model-config.json contains invalid JSON, using defaults.', error);
      return { ...DEFAULT_OPENROUTER_MODELS };
    }
  }

  private buildOpenRouterProviders(tiers: OpenRouterTierConfig): {
    routine: OpenRouterProvider;
    standard: OpenRouterProvider;
    complex: OpenRouterProvider;
  } {
    return {
      routine: new OpenRouterProvider(tiers.routine),
      standard: new OpenRouterProvider(tiers.standard),
      complex: new OpenRouterProvider(tiers.complex),
    };
  }

  /**
   * Returns the best provider for a given complexity level.
   * Uses the configured primary provider.
   */
  getProvider(complexity: TaskComplexity): LLMProvider {
    switch (this.config.primary) {
      case 'gemini':
        return complexity === 'routine'
          ? this.gemini.routine
          : complexity === 'standard'
            ? this.gemini.standard
            : this.gemini.complex;
      case 'openai':
        return complexity === 'routine'
          ? this.openai.routine
          : complexity === 'standard'
            ? this.openai.standard
            : this.openai.complex;
      case 'openrouter':
        return complexity === 'routine'
          ? this.openrouter.routine
          : complexity === 'standard'
            ? this.openrouter.standard
            : this.openrouter.complex;
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
   * Claude Opus + Gemini Pro + GPT-5 in parallel.
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

  /** Removes this instance from the global registry. Call on shutdown to prevent memory leaks. */
  destroy(): void {
    ModelRouter.instances.delete(this);
  }

  /** Remove this instance from the static instance set to allow garbage collection. */
  dispose(): void {
    this.destroy();
  }

  /** Convenience: provider for routine compression/tool-selection tasks */
  get routine(): LLMProvider { return this.getProvider('routine'); }

  /** Convenience: provider for standard orchestrator/coding tasks */
  get standard(): LLMProvider { return this.getProvider('standard'); }

  /** Convenience: provider for complex single-model reasoning */
  get complex(): LLMProvider { return this.getProvider('complex'); }
}
