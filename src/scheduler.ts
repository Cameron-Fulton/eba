import * as fs from 'fs';
import * as path from 'path';
import { BenchmarkUpdater } from './providers/benchmark-updater';
import { ModelRouter } from './providers/model-router';

interface ModelConfigFile {
  updated_at?: string;
  interval_hours?: number;
}

const MODEL_CONFIG_PATH = path.resolve(__dirname, 'providers', 'model-config.json');
const DEFAULT_INTERVAL_HOURS = 30;

function readSchedulerConfig(configPath: string): Required<ModelConfigFile> {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as ModelConfigFile;

    return {
      updated_at: parsed.updated_at ?? new Date(0).toISOString(),
      interval_hours: parsed.interval_hours ?? DEFAULT_INTERVAL_HOURS,
    };
  } catch (error) {
    console.warn('[BenchmarkScheduler] Failed to read config; using defaults.', error);
    return {
      updated_at: new Date(0).toISOString(),
      interval_hours: DEFAULT_INTERVAL_HOURS,
    };
  }
}

function isStale(updatedAtIso: string, intervalHours: number): boolean {
  const updatedAtMs = Date.parse(updatedAtIso);
  if (!Number.isFinite(updatedAtMs)) {
    return true;
  }

  const ageMs = Date.now() - updatedAtMs;
  return ageMs >= intervalHours * 60 * 60 * 1000;
}

async function runBenchmarkRefresh(configPath: string): Promise<void> {
  const startedAt = new Date().toISOString();
  console.log(`[BenchmarkScheduler] Update cycle started at ${startedAt}`);

  try {
    await BenchmarkUpdater.update(configPath);
    ModelRouter.reloadOpenRouterModels();
    const finishedAt = new Date().toISOString();
    console.log(`[BenchmarkScheduler] Update cycle completed at ${finishedAt}`);
  } catch (error) {
    console.error('[BenchmarkScheduler] Update cycle failed:', error);
  }
}

export function startBenchmarkScheduler(router: ModelRouter): void {
  // Keep an explicit reference and make intent clear for future router-level hooks.
  void router;

  const config = readSchedulerConfig(MODEL_CONFIG_PATH);
  const intervalHours = config.interval_hours || DEFAULT_INTERVAL_HOURS;
  const intervalMs = intervalHours * 60 * 60 * 1000;

  console.log(`[BenchmarkScheduler] Starting with interval=${intervalHours}h`);

  if (isStale(config.updated_at, intervalHours)) {
    void runBenchmarkRefresh(MODEL_CONFIG_PATH);
  } else {
    console.log(`[BenchmarkScheduler] Config is fresh (updated_at=${config.updated_at}); skipping immediate refresh.`);
  }

  setInterval(() => {
    void runBenchmarkRefresh(MODEL_CONFIG_PATH);
  }, intervalMs);
}
