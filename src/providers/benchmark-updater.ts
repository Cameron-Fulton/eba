import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

interface OpenRouterPricing {
  prompt?: string;
  completion?: string;
}

interface OpenRouterModel {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  pricing?: OpenRouterPricing;
  top_provider?: string;
}

interface OpenRouterModelConfig {
  routine: string;
  standard: string;
  complex: string;
}

interface ArtificialAnalysisModel {
  model_id: string;
  provider_slug?: string;
  coding_index?: number;
  swe_bench?: number;
  quality_index?: number;
}

interface ModelConfig {
  updated_at: string;
  interval_hours?: number;
  known_good_models?: string[];
  openrouter: OpenRouterModelConfig;
}

type ModelTier = keyof OpenRouterModelConfig;

interface ScoredCandidate {
  model: OpenRouterModel;
  promptPrice: number;
  completionPrice: number;
  score: number;
  reason: string;
}

const OPENROUTER_MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models';
const ARTIFICIAL_ANALYSIS_API_ENDPOINT = 'https://artificialanalysis.ai/api/v1/models';
const DEFAULT_INTERVAL_HOURS = 30;

const DEFAULT_OPENROUTER_MODELS: OpenRouterModelConfig = {
  routine: 'qwen/qwen3-coder',
  standard: 'minimax/minimax-m2.5',
  complex: 'moonshotai/kimi-k2-thinking',
};

const DEFAULT_KNOWN_GOOD_MODEL_IDS = [
  'qwen/qwen3-coder',
  'minimax/minimax-m2.5',
  'moonshotai/kimi-k2-thinking',
  'anthropic/claude-opus-4-6',
  'google/gemini-3-flash-preview',
  'openai/gpt-5',
  'openai/gpt-4o',
  'anthropic/claude-sonnet-4-5',
];

export class BenchmarkUpdater {
  private readonly configPath: string;
  private knownGoodModels: Set<string>;

  constructor(configPath: string) {
    this.configPath = configPath;
    this.knownGoodModels = new Set(DEFAULT_KNOWN_GOOD_MODEL_IDS);
  }

  static async update(configPath: string): Promise<void> {
    const updater = new BenchmarkUpdater(configPath);
    await updater.run();
  }

  private async run(): Promise<void> {
    if (!process.env.OPENROUTER_API_KEY) {
      console.warn('[BenchmarkUpdater] OPENROUTER_API_KEY missing; skipping benchmark update.');
      return;
    }

    const existingConfig = this.readConfig();
    this.knownGoodModels = new Set(existingConfig.known_good_models ?? DEFAULT_KNOWN_GOOD_MODEL_IDS);
    const models = await this.fetchModels();

    if (models.length === 0) {
      console.warn('[BenchmarkUpdater] No models returned from OpenRouter; keeping current config.');
      return;
    }

    const aaScores = await this.fetchArtificialAnalysisScores();

    const routinePick = this.pickBestCandidate('routine', models, existingConfig.openrouter.routine);
    const standardPick = this.pickBestCandidate('standard', models, existingConfig.openrouter.standard);
    const complexPick = this.pickBestCandidate('complex', models, existingConfig.openrouter.complex, aaScores);

    const nextConfig: ModelConfig = {
      updated_at: new Date().toISOString(),
      interval_hours: existingConfig.interval_hours ?? DEFAULT_INTERVAL_HOURS,
      known_good_models: Array.from(this.knownGoodModels),
      openrouter: {
        routine: routinePick.model.id,
        standard: standardPick.model.id,
        complex: complexPick.model.id,
      },
    };

    await this.writeConfig(nextConfig);

    console.log('[BenchmarkUpdater] Updated OpenRouter model tiers:');
    this.logPick('routine', routinePick);
    this.logPick('standard', standardPick);
    this.logPick('complex', complexPick);
  }

  private async fetchModels(): Promise<OpenRouterModel[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    if (typeof (timeout as NodeJS.Timeout).unref === 'function') {
      (timeout as NodeJS.Timeout).unref();
    }

    let response: Response;
    try {
      response = await fetch(OPENROUTER_MODELS_ENDPOINT, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`[BenchmarkUpdater] OpenRouter model fetch failed (${response.status} ${response.statusText})`);
    }

    const payload = (await response.json()) as OpenRouterModel[] | { data?: OpenRouterModel[] };
    const models = Array.isArray(payload) ? payload : payload.data ?? [];

    console.log(`[BenchmarkUpdater] Retrieved ${models.length} OpenRouter models from API.`);
    return models;
  }

  private async fetchArtificialAnalysisScores(): Promise<Map<string, ArtificialAnalysisModel>> {
    if (!process.env.AA_API_KEY) {
      console.warn(
        '[BenchmarkUpdater] AA_API_KEY missing; using price-proxy fallback for complex tier scoring.',
      );
      return new Map<string, ArtificialAnalysisModel>();
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    if (typeof (timeout as NodeJS.Timeout).unref === 'function') {
      (timeout as NodeJS.Timeout).unref();
    }

    try {
      const response = await fetch(ARTIFICIAL_ANALYSIS_API_ENDPOINT, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${process.env.AA_API_KEY}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `[BenchmarkUpdater] Artificial Analysis model fetch failed (${response.status} ${response.statusText})`,
        );
      }

      const payload = (await response.json()) as ArtificialAnalysisModel[] | { data?: ArtificialAnalysisModel[] };
      const models = Array.isArray(payload) ? payload : payload.data ?? [];
      const byModelId = new Map<string, ArtificialAnalysisModel>(models.map(model => [model.model_id, model]));

      console.log(`[BenchmarkUpdater] Retrieved ${byModelId.size} Artificial Analysis model scores from API.`);
      return byModelId;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(
        `[BenchmarkUpdater] Failed to fetch Artificial Analysis scores; using price-proxy fallback for complex tier. ${detail}`,
      );
      return new Map<string, ArtificialAnalysisModel>();
    } finally {
      clearTimeout(timeout);
    }
  }

  private pickBestCandidate(
    tier: ModelTier,
    models: OpenRouterModel[],
    fallbackModelId: string,
    aaScores?: Map<string, ArtificialAnalysisModel>,
  ): ScoredCandidate {
    const filteredByTier = models.filter(model => this.meetsTierConstraints(model, tier));

    const trustedOrPremium = filteredByTier.filter(model => this.isKnownGood(model.id) || this.isPremiumPriced(model));
    const pool = trustedOrPremium.length > 0 ? trustedOrPremium : filteredByTier;

    if (pool.length === 0) {
      console.warn(`[BenchmarkUpdater] No candidates for ${tier}; falling back to ${fallbackModelId}`);
      return {
        model: { id: fallbackModelId },
        promptPrice: Number.POSITIVE_INFINITY,
        completionPrice: Number.POSITIVE_INFINITY,
        score: Number.POSITIVE_INFINITY,
        reason: 'fallback_no_candidates',
      };
    }

    const scored = pool
      .map(model => this.scoreCandidate(model, tier, aaScores))
      .sort((a, b) => a.score - b.score);

    return scored[0];
  }

  private meetsTierConstraints(model: OpenRouterModel, tier: ModelTier): boolean {
    const contextLength = model.context_length ?? 0;
    const text = `${model.id} ${model.name ?? ''} ${model.description ?? ''}`.toLowerCase();

    if (tier === 'routine') {
      return contextLength >= 32_000 && (text.includes('coder') || text.includes('code') || text.includes('flash') || text.includes('mini'));
    }

    if (tier === 'standard') {
      return contextLength >= 64_000;
    }

    return contextLength >= 100_000 && (text.includes('reason') || text.includes('thinking') || text.includes('opus') || text.includes('gpt'));
  }

  private scoreCandidate(
    model: OpenRouterModel,
    tier: ModelTier,
    aaScores?: Map<string, ArtificialAnalysisModel>,
  ): ScoredCandidate {
    const promptPrice = this.parsePrice(model.pricing?.prompt);
    const completionPrice = this.parsePrice(model.pricing?.completion);
    const totalPrice = promptPrice + completionPrice;
    const contextLength = Math.max(model.context_length ?? 0, 1);

    let score: number;
    let reason: string;

    if (tier === 'routine') {
      score = promptPrice;
      reason = `lowest_prompt_price=${promptPrice.toFixed(8)}`;
    } else if (tier === 'standard') {
      score = totalPrice / contextLength;
      reason = `balanced_cost_context total=${totalPrice.toFixed(8)} context=${contextLength}`;
    } else if (aaScores && aaScores.size > 0) {
      const aaEntry = aaScores.get(model.id);

      if (aaEntry) {
        const codingScore = aaEntry.coding_index ?? aaEntry.swe_bench ?? aaEntry.quality_index ?? 0;
        score = -codingScore;
        reason = `aa_coding_index=${codingScore}`;
      } else {
        // Artificial Analysis did not include this model; keep price-proxy as fallback for ranking.
        score = -totalPrice;
        reason = `aa_missing_fallback_price_proxy total=${totalPrice.toFixed(8)}`;
      }
    } else {
      score = -totalPrice;
      reason = `highest_price_proxy_for_quality total=${totalPrice.toFixed(8)}`;
    }

    if (this.isKnownGood(model.id)) {
      score -= tier === 'complex' ? 0.000005 : 0.000001;
      reason += ' +known_good_bonus';
    }

    return {
      model,
      promptPrice,
      completionPrice,
      score,
      reason,
    };
  }

  private parsePrice(rawPrice: string | undefined): number {
    if (!rawPrice) {
      return Number.POSITIVE_INFINITY;
    }

    const parsed = Number.parseFloat(rawPrice);
    if (!Number.isFinite(parsed)) {
      return Number.POSITIVE_INFINITY;
    }

    return parsed;
  }

  private isKnownGood(modelId: string): boolean {
    return this.knownGoodModels.has(modelId);
  }

  private isPremiumPriced(model: OpenRouterModel): boolean {
    const prompt = this.parsePrice(model.pricing?.prompt);
    const completion = this.parsePrice(model.pricing?.completion);

    return prompt >= 0.000004 || completion >= 0.000012;
  }

  private readConfig(): ModelConfig {
    const defaults: ModelConfig = {
      updated_at: new Date(0).toISOString(),
      interval_hours: DEFAULT_INTERVAL_HOURS,
      known_good_models: [...DEFAULT_KNOWN_GOOD_MODEL_IDS],
      openrouter: { ...DEFAULT_OPENROUTER_MODELS },
    };

    if (!fs.existsSync(this.configPath)) {
      return defaults;
    }

    const raw = fs.readFileSync(this.configPath, 'utf-8');

    let parsed: Partial<ModelConfig>;
    try {
      parsed = JSON.parse(raw) as Partial<ModelConfig>;
    } catch (error) {
      console.warn('[BenchmarkUpdater] model-config.json contains invalid JSON, using defaults.', error);
      return defaults;
    }

    return {
      updated_at: parsed.updated_at ?? defaults.updated_at,
      interval_hours: parsed.interval_hours ?? DEFAULT_INTERVAL_HOURS,
      known_good_models:
        parsed.known_good_models && parsed.known_good_models.length > 0
          ? parsed.known_good_models
          : [...DEFAULT_KNOWN_GOOD_MODEL_IDS],
      openrouter: {
        routine: parsed.openrouter?.routine ?? DEFAULT_OPENROUTER_MODELS.routine,
        standard: parsed.openrouter?.standard ?? DEFAULT_OPENROUTER_MODELS.standard,
        complex: parsed.openrouter?.complex ?? DEFAULT_OPENROUTER_MODELS.complex,
      },
    };
  }

  private async writeConfig(config: ModelConfig): Promise<void> {
    const dir = path.dirname(this.configPath);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(this.configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  }

  private logPick(tier: ModelTier, pick: ScoredCandidate): void {
    const context = pick.model.context_length ?? 0;
    console.log(
      `[BenchmarkUpdater] ${tier}: ${pick.model.id} | context=${context} | prompt=${pick.promptPrice} | completion=${pick.completionPrice} | reason=${pick.reason}`,
    );
  }
}
