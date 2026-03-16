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
import { ClaudeProvider, ClaudeModel } from './claude-provider';
import { GeminiProvider, GeminiModel } from './gemini-provider';
import { OpenAIProvider, OpenAIModel } from './openai-provider';
import { OpenRouterProvider } from './openrouter-provider';
import { ConsortiumVoter, ConsortiumConfig } from '../phase3/consortium-voter';

export type TaskComplexity = 'routine' | 'standard' | 'complex';

export interface ModelRouterConfig {
  /** Primary provider used for orchestrator and thread workers */
  primary: 'claude' | 'gemini' | 'openai' | 'openrouter';
  /** Whether to enable the full three-model consortium for complex tasks */
  enableConsortium: boolean;
}

// ── Default model identifiers ──────────────────────────────────────────────

const CLAUDE_MODELS: Record<TaskComplexity, ClaudeModel> = {
  routine:  'claude-haiku-4-5',
  standard: 'claude-sonnet-4-6',
  complex:  'claude-opus-4-6',
};

const GEMINI_MODELS: Record<TaskComplexity, GeminiModel> = {
  routine:  'gemini-3-flash-preview',
  standard: 'gemini-3.1-pro-preview',
  complex:  'gemini-3.1-pro-preview',
};

const OPENAI_MODELS: Record<TaskComplexity, OpenAIModel> = {
  routine:  'gpt-5-mini',
  standard: 'gpt-5.4',
  complex:  'o3',
};

const DEFAULT_OPENROUTER_MODELS: Record<TaskComplexity, string> = {
  routine:  'qwen/qwen3-coder',
  standard: 'minimax/minimax-m2.5',
  complex:  'moonshotai/kimi-k2.5',
};

// ── Config file types ──────────────────────────────────────────────────────

interface OpenRouterConfigFile {
  updated_at?: string;
  interval_hours?: number;
  openrouter?: Partial<Record<TaskComplexity, string>>;
}

const MODEL_CONFIG_PATH = path.resolve(__dirname, 'model-config.json');

// ── Helper ─────────────────────────────────────────────────────────────────

/** Picks the provider instance matching the requested complexity tier. */
function pickTier<T>(tiers: Record<TaskComplexity, T>, complexity: TaskComplexity): T {
  return tiers[complexity];
}

// ──────────────────────────────────────────────────────────────────────────

export class ModelRouter {
  private static instances = new Set<ModelRouter>();

  private claude:    Record<TaskComplexity, ClaudeProvider>;
  private gemini:    Record<TaskComplexity, GeminiProvider>;
  private openai:    Record<TaskComplexity, OpenAIProvider>;
  private openrouter: Record<TaskComplexity, OpenRouterProvider>;
  private config: ModelRouterConfig;

  constructor(config: ModelRouterConfig = { primary: 'claude', enableConsortium: true }) {
    this.config = config;

    this.claude = {
      routine:  new ClaudeProvider(CLAUDE_MODELS.routine),
      standard: new ClaudeProvider(CLAUDE_MODELS.standard),
      complex:  new ClaudeProvider(CLAUDE_MODELS.complex),
    };

    this.gemini = {
      routine:  new GeminiProvider(GEMINI_MODELS.routine),
      standard: new GeminiProvider(GEMINI_MODELS.standard),
      complex:  new GeminiProvider(GEMINI_MODELS.complex),
    };

    this.openai = {
      routine:  new OpenAIProvider(OPENAI_MODELS.routine),
      standard: new OpenAIProvider(OPENAI_MODELS.standard),
      complex:  new OpenAIProvider(OPENAI_MODELS.complex),
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

  private static loadOpenRouterTierConfig(): Record<TaskComplexity, string> {
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
        routine:  parsed.openrouter?.routine  ?? DEFAULT_OPENROUTER_MODELS.routine,
        standard: parsed.openrouter?.standard ?? DEFAULT_OPENROUTER_MODELS.standard,
        complex:  parsed.openrouter?.complex  ?? DEFAULT_OPENROUTER_MODELS.complex,
      };
    } catch (error) {
      console.warn('[ModelRouter] model-config.json contains invalid JSON, using defaults.', error);
      return { ...DEFAULT_OPENROUTER_MODELS };
    }
  }

  private buildOpenRouterProviders(
    tiers: Record<TaskComplexity, string>,
  ): Record<TaskComplexity, OpenRouterProvider> {
    return {
      routine:  new OpenRouterProvider(tiers.routine),
      standard: new OpenRouterProvider(tiers.standard),
      complex:  new OpenRouterProvider(tiers.complex),
    };
  }

  /**
   * Returns the best provider for a given complexity level.
   * Uses the configured primary provider.
   */
  getProvider(complexity: TaskComplexity): LLMProvider {
    switch (this.config.primary) {
      case 'gemini':     return pickTier(this.gemini,    complexity);
      case 'openai':     return pickTier(this.openai,    complexity);
      case 'openrouter': return pickTier(this.openrouter, complexity);
      case 'claude':
      default:           return pickTier(this.claude,    complexity);
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

  /** Convenience: provider for routine compression/tool-selection tasks */
  get routine(): LLMProvider { return this.getProvider('routine'); }

  /** Convenience: provider for standard orchestrator/coding tasks */
  get standard(): LLMProvider { return this.getProvider('standard'); }

  /** Convenience: provider for complex single-model reasoning */
  get complex(): LLMProvider { return this.getProvider('complex'); }
}
