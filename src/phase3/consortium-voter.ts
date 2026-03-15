/**
 * Phase 3: Consortium Voter
 * Queries multiple LLM providers in parallel, clusters responses
 * by semantic similarity, and returns majority consensus.
 */

export interface LLMProviderConfig {
  name: string;
  call: (prompt: string) => Promise<string>;
}

export interface VoteResult {
  consensus: string;
  confidence: number;
  total_votes: number;
  cluster_size: number;
  all_responses: ProviderResponse[];
  clusters: ResponseCluster[];
}

export interface ProviderResponse {
  provider: string;
  response: string;
  latency_ms: number;
  error?: string;
}

export interface ResponseCluster {
  representative: string;
  members: string[];
  size: number;
}

export interface ConsortiumConfig {
  providers: LLMProviderConfig[];
  quorum_threshold: number; // 0.0 to 1.0, fraction of providers that must agree
  similarity_threshold: number; // 0.0 to 1.0, how similar responses must be to cluster
}

/**
 * Simple word-overlap similarity metric.
 * In production, use embeddings for semantic similarity.
 */
export function computeSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));

  if (wordsA.size === 0 && wordsB.size === 0) return 1.0;
  if (wordsA.size === 0 || wordsB.size === 0) return 0.0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? intersection / union : 0;
}

export function clusterResponses(
  responses: ProviderResponse[],
  similarityThreshold: number
): ResponseCluster[] {
  const successful = responses.filter(r => !r.error);
  if (successful.length === 0) return [];

  const assigned = new Set<number>();
  const clusters: ResponseCluster[] = [];

  for (let i = 0; i < successful.length; i++) {
    if (assigned.has(i)) continue;

    const cluster: ResponseCluster = {
      representative: successful[i].response,
      members: [successful[i].provider],
      size: 1,
    };
    assigned.add(i);

    for (let j = i + 1; j < successful.length; j++) {
      if (assigned.has(j)) continue;
      const sim = computeSimilarity(successful[i].response, successful[j].response);
      if (sim >= similarityThreshold) {
        cluster.members.push(successful[j].provider);
        cluster.size++;
        assigned.add(j);
      }
    }

    clusters.push(cluster);
  }

  return clusters.sort((a, b) => b.size - a.size);
}

export class ConsortiumVoter {
  private config: ConsortiumConfig;

  constructor(config: ConsortiumConfig) {
    if (config.providers.length === 0) {
      throw new Error('At least one provider is required');
    }
    if (config.quorum_threshold < 0 || config.quorum_threshold > 1) {
      throw new Error('Quorum threshold must be between 0 and 1');
    }
    this.config = config;
  }

  async vote(prompt: string): Promise<VoteResult> {
    // Query all providers in parallel
    const responsePromises = this.config.providers.map(async (provider): Promise<ProviderResponse> => {
      const start = Date.now();
      try {
        const response = await provider.call(prompt);
        return {
          provider: provider.name,
          response,
          latency_ms: Date.now() - start,
        };
      } catch (err) {
        return {
          provider: provider.name,
          response: '',
          latency_ms: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    const allResponses = await Promise.all(responsePromises);
    const clusters = clusterResponses(allResponses, this.config.similarity_threshold);

    if (clusters.length === 0) {
      return {
        consensus: '',
        confidence: 0,
        total_votes: allResponses.length,
        cluster_size: 0,
        all_responses: allResponses,
        clusters: [],
      };
    }

    const largest = clusters[0];
    const successfulCount = allResponses.filter(r => !r.error).length;
    const confidence = successfulCount > 0 ? largest.size / successfulCount : 0;
    const meetsQuorum = confidence >= this.config.quorum_threshold;

    return {
      consensus: meetsQuorum ? largest.representative : '',
      confidence,
      total_votes: allResponses.length,
      cluster_size: largest.size,
      all_responses: allResponses,
      clusters,
    };
  }
}
