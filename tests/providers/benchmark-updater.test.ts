import { BenchmarkUpdater } from '../../src/providers/benchmark-updater';

describe('BenchmarkUpdater', () => {
  let updater: BenchmarkUpdater;
  let originalFetch: typeof global.fetch | undefined;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
    process.env.AA_API_KEY = 'test-aa-key';

    updater = new BenchmarkUpdater('/tmp/test-model-config.json');

    originalFetch = global.fetch;
    (global as any).fetch = jest.fn();
  });

  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.AA_API_KEY;
    jest.clearAllMocks();

    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete (global as any).fetch;
    }
  });

  describe('fetchArtificialAnalysisScores', () => {
    test('returns empty Map when AA_API_KEY is missing', async () => {
      delete process.env.AA_API_KEY;

      const result = await (updater as any).fetchArtificialAnalysisScores();

      expect(result.size).toBe(0);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('maps array-envelope response by model_id', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue([
          { model_id: 'model-a', coding_index: 85 },
          { model_id: 'model-b', swe_bench: 72 },
        ]),
      });

      const result = await (updater as any).fetchArtificialAnalysisScores();

      expect(result.size).toBe(2);
      expect(result.get('model-a').coding_index).toBe(85);
    });

    test('maps data-envelope response { data: [...] } by model_id', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: [{ model_id: 'model-c', quality_index: 60 }],
        }),
      });

      const result = await (updater as any).fetchArtificialAnalysisScores();

      expect(result.size).toBe(1);
      expect(result.get('model-c').quality_index).toBe(60);
    });

    test('returns empty Map when fetch throws', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network failure'));

      const result = await (updater as any).fetchArtificialAnalysisScores();

      expect(result.size).toBe(0);
    });
  });

  describe('scoreCandidate — complex tier', () => {
    const makeModel = (
      id: string,
      prompt = '0.000010',
      completion = '0.000030',
      context = 128000,
    ) => ({
      id,
      pricing: { prompt, completion },
      context_length: context,
    });

    test('AA hit: uses coding_index (negated) as score', () => {
      const aaScores = new Map([
        ['model-x', { model_id: 'model-x', coding_index: 90 }],
      ]);
      const model = makeModel('model-x');

      const result = (updater as any).scoreCandidate(model, 'complex', aaScores);

      expect(result.score).toBe(-90);
      expect(result.reason).toContain('aa_coding_index=90');
    });

    test('AA hit: falls back through swe_bench when coding_index absent', () => {
      const aaScores = new Map([
        ['model-x', { model_id: 'model-x', swe_bench: 55 }],
      ]);
      const model = makeModel('model-x');

      const result = (updater as any).scoreCandidate(model, 'complex', aaScores);

      expect(result.score).toBe(-55);
      expect(result.reason).toContain('aa_coding_index=55');
    });

    test('AA miss: falls back to negative total price when model not in map', () => {
      const aaScores = new Map([
        ['other-model', { model_id: 'other-model', coding_index: 70 }],
      ]);
      const model = makeModel('model-x', '0.000010', '0.000030');

      const result = (updater as any).scoreCandidate(model, 'complex', aaScores);

      expect(result.score).toBeCloseTo(-0.00004, 8);
      expect(result.reason).toContain('aa_missing_fallback');
    });

    test('isKnownGood bonus reduces score for complex tier', () => {
      const model = makeModel('qwen/qwen3-coder');
      const aaScores = new Map([
        ['qwen/qwen3-coder', { model_id: 'qwen/qwen3-coder', coding_index: 80 }],
      ]);

      const result = (updater as any).scoreCandidate(model, 'complex', aaScores);

      expect(result.score).toBeCloseTo(-80.000005, 8);
      expect(result.reason).toContain('known_good_bonus');
    });
  });
});
