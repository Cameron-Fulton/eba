import {
  ConsortiumVoter,
  computeSimilarity,
  clusterResponses,
  LLMProviderConfig,
  ProviderResponse,
} from '../../src/phase3/consortium-voter';

describe('Similarity Computation', () => {
  test('identical strings have similarity 1.0', () => {
    expect(computeSimilarity('hello world test', 'hello world test')).toBe(1.0);
  });

  test('completely different strings have low similarity', () => {
    const sim = computeSimilarity('the quick brown fox', 'lambda calculus theory');
    expect(sim).toBeLessThan(0.2);
  });

  test('partially overlapping strings have medium similarity', () => {
    const sim = computeSimilarity('use typescript for safety', 'use typescript for speed');
    expect(sim).toBeGreaterThan(0.3);
    expect(sim).toBeLessThan(1.0);
  });

  test('empty strings have similarity 1.0', () => {
    expect(computeSimilarity('', '')).toBe(1.0);
  });
});

describe('Response Clustering', () => {
  test('clusters identical responses together', () => {
    const responses: ProviderResponse[] = [
      { provider: 'A', response: 'use typescript for this project', latency_ms: 100 },
      { provider: 'B', response: 'use typescript for this project', latency_ms: 150 },
      { provider: 'C', response: 'use python for this project', latency_ms: 120 },
    ];

    const clusters = clusterResponses(responses, 0.8);
    expect(clusters.length).toBeGreaterThanOrEqual(1);
    expect(clusters[0].size).toBe(2); // A and B clustered (identical responses)
  });

  test('filters out error responses', () => {
    const responses: ProviderResponse[] = [
      { provider: 'A', response: 'good answer', latency_ms: 100 },
      { provider: 'B', response: '', latency_ms: 0, error: 'API error' },
    ];

    const clusters = clusterResponses(responses, 0.5);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members).toEqual(['A']);
  });
});

describe('Consortium Voter', () => {
  function mockProvider(name: string, response: string): LLMProviderConfig {
    return { name, call: jest.fn().mockResolvedValue(response) };
  }

  function mockFailingProvider(name: string): LLMProviderConfig {
    return { name, call: jest.fn().mockRejectedValue(new Error('API down')) };
  }

  test('reaches consensus with agreeing providers', async () => {
    const voter = new ConsortiumVoter({
      providers: [
        mockProvider('claude', 'use typescript for safety and tooling'),
        mockProvider('gpt4', 'use typescript for safety and tooling'),
        mockProvider('gemini', 'use python for data science work'),
      ],
      quorum_threshold: 0.5,
      similarity_threshold: 0.5,
    });

    const result = await voter.vote('What language should we use?');
    expect(result.consensus).toBeTruthy();
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    expect(result.total_votes).toBe(3);
    expect(result.cluster_size).toBeGreaterThanOrEqual(2);
  });

  test('returns empty consensus when quorum not met', async () => {
    const voter = new ConsortiumVoter({
      providers: [
        mockProvider('claude', 'answer alpha'),
        mockProvider('gpt4', 'answer beta'),
        mockProvider('gemini', 'answer gamma'),
      ],
      quorum_threshold: 0.9,
      similarity_threshold: 0.9,
    });

    const result = await voter.vote('What is the answer?');
    // All responses are different, no cluster meets 90% quorum
    expect(result.confidence).toBeLessThan(0.9);
  });

  test('handles provider failures gracefully', async () => {
    const voter = new ConsortiumVoter({
      providers: [
        mockProvider('claude', 'good answer here'),
        mockFailingProvider('gpt4'),
        mockProvider('gemini', 'good answer here'),
      ],
      quorum_threshold: 0.5,
      similarity_threshold: 0.5,
    });

    const result = await voter.vote('Test');
    expect(result.all_responses.filter(r => r.error)).toHaveLength(1);
    expect(result.consensus).toBeTruthy();
  });

  test('throws with no providers', () => {
    expect(() => new ConsortiumVoter({
      providers: [],
      quorum_threshold: 0.5,
      similarity_threshold: 0.5,
    })).toThrow('At least one provider');
  });

  test('throws with invalid quorum threshold', () => {
    expect(() => new ConsortiumVoter({
      providers: [mockProvider('test', 'x')],
      quorum_threshold: 1.5,
      similarity_threshold: 0.5,
    })).toThrow('Quorum threshold must be between 0 and 1');
  });
});
