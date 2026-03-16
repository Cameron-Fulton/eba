/**
 * Benchmark: SOP Coverage
 * Measures how many task prompts are covered by registered SOP guidance.
 */

import { SOPEngine, SOPDefinition } from '../phase2/sop';
import { computeSimilarity } from '../phase3/consortium-voter';

export interface TaskCoverage {
  task: string;
  matched_sop: string | null;
  confidence: number;
}

export interface BenchmarkResult {
  score: number;
  total: number;
  covered: number;
  breakdown: TaskCoverage[];
}

export class SOPCoverageBenchmark {
  private readonly tasks: string[];
  private readonly sopEngine: SOPEngine;
  private readonly matchThreshold: number;

  constructor(taskPrompts: string[], sopEngine: SOPEngine, matchThreshold: number = 0.5) {
    this.tasks = [...taskPrompts];
    this.sopEngine = sopEngine;
    this.matchThreshold = matchThreshold;
  }

  run(): BenchmarkResult {
    const sops = this.sopEngine.getRegisteredSOPs();
    const breakdown = this.tasks.map(task => this.evaluateTaskCoverage(task, sops));

    const total = breakdown.length;
    const covered = breakdown.filter(item => item.matched_sop !== null).length;
    const score = total > 0 ? covered / total : 0;

    return {
      score,
      total,
      covered,
      breakdown,
    };
  }

  private evaluateTaskCoverage(task: string, sops: SOPDefinition[]): TaskCoverage {
    let bestMatch: SOPDefinition | null = null;
    let bestConfidence = 0;

    for (const sop of sops) {
      const nameSimilarity = computeSimilarity(task, sop.name);
      const descriptionSimilarity = computeSimilarity(task, sop.description);
      const combinedSimilarity = computeSimilarity(task, `${sop.name} ${sop.description}`);
      const confidence = Math.max(nameSimilarity, descriptionSimilarity, combinedSimilarity);

      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestMatch = sop;
      }
    }

    if (!bestMatch || bestConfidence < this.matchThreshold) {
      return {
        task,
        matched_sop: null,
        confidence: bestConfidence,
      };
    }

    return {
      task,
      matched_sop: bestMatch.name,
      confidence: bestConfidence,
    };
  }
}
