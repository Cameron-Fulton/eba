// Phase 1: Foundation
export { compressTranscript, serializePacket, deserializePacket, validateMemoryPacket } from './phase1/memory-packet';
export type { MemoryPacket, Decision, FileChange, OpenThread, PacketMetadata, RejectedIdea, Risk, Entity, VocabularyEntry, SessionMeta } from './phase1/memory-packet';
export { NegativeKnowledgeStore } from './phase1/negative-knowledge';
export type { NegativeKnowledgeEntry } from './phase1/negative-knowledge';
export { CompressionAgent } from './phase1/compression-agent';
export type { CompressionAgentConfig } from './phase1/compression-agent';
export { BlueprintOrchestrator } from './phase1/orchestrator';
export type { OrchestratorConfig, LLMProvider, TestRunner, TestResult, ExecutionLog } from './phase1/orchestrator';
export { AIIndex } from './phase1/ai-index';

// Phase 2: Execution Engine
export { ThreadManager } from './phase2/thread-manager';
export type { Episode, ThreadConfig, ThreadExecutor, WorkerThread } from './phase2/thread-manager';
export { ToolShed, createDefaultToolShed } from './phase2/tool-shed';
export type { ToolSchema, ToolParameter } from './phase2/tool-shed';
export { SOPEngine, createRefactoringSOP } from './phase2/sop';
export type { SOPDefinition, SOPStep } from './phase2/sop';
export { createBugFixSOP, createFeatureSOP, createCodeReviewSOP, createDependencyUpgradeSOP, createDeploymentSOP } from './phase2/sop-library';
export { createOrchestratorExecutor, buildAttemptPrompt } from './phase2/thread-executor';
export type { ThreadExecutorConfig } from './phase2/thread-executor';

// Phase 3: Validation & Safety
export { ConsortiumVoter, computeSimilarity, clusterResponses } from './phase3/consortium-voter';
export type { ConsortiumConfig, VoteResult, LLMProviderConfig, ProviderResponse, ResponseCluster } from './phase3/consortium-voter';
export { VisualProofSystem } from './phase3/visual-proof';
export type { ProofReport, ProofContext, ProofCheck, ProofScreenshot, VisualProofHook, ExpectedState } from './phase3/visual-proof';
export { ThreePillarModel } from './phase3/three-pillar-model';
export type { ActionClassification, RiskLevel, ApprovalHandler, ApprovalRequest, DecisionJournalEntry, StateChangeLog } from './phase3/three-pillar-model';

// Phase 4: Auto-Research & Scale
export { ArenaLoop } from './phase4/arena-loop';
export type { ArenaConfig, ArenaState, ArenaOptimizer, IterationResult } from './phase4/arena-loop';
export { ParallelNegativeKnowledge } from './phase4/parallel-negative-knowledge';
export type { TaskAttempt } from './phase4/parallel-negative-knowledge';

// Pipeline
export { EBAPipeline } from './pipeline/eba-pipeline';
export type { EBAPipelineConfig, PipelineResult } from './pipeline/eba-pipeline';
export { PromptEnhancer } from './pipeline/prompt-enhancer';
export type { PromptEnhancerConfig } from './pipeline/prompt-enhancer';
export { ProjectOrchestrator } from './pipeline/project-orchestrator';
export type { ProjectOrchestratorConfig, PlanningResult } from './pipeline/project-orchestrator';
export { TaskQueue } from './pipeline/task-queue';
export type { TaskSpec, ClaimedTask, TaskResult, QueueStats } from './pipeline/task-queue';
export { MergeAgent, mergePackets } from './pipeline/merge-agent';
export type { MergeAgentConfig, MergeResult } from './pipeline/merge-agent';

// Providers
export { ClaudeProvider } from './providers/claude-provider';
export type { ClaudeModel } from './providers/claude-provider';
export { GeminiProvider } from './providers/gemini-provider';
export type { GeminiModel } from './providers/gemini-provider';
export { OpenAIProvider } from './providers/openai-provider';
export type { OpenAIModel } from './providers/openai-provider';
export { OpenRouterProvider } from './providers/openrouter-provider';
export type { OpenRouterModel } from './providers/openrouter-provider';
export { ModelRouter } from './providers/model-router';
export type { ModelRouterConfig, TaskComplexity } from './providers/model-router';

// Utilities
export { ShellTestRunner } from './utils/shell-test-runner';
export type { ShellTestRunnerConfig } from './utils/shell-test-runner';
export { retryWithBackoff } from './utils/shell-test-runner';
export type { RetryWithBackoffOptions } from './utils/shell-test-runner';
export { tokenCount } from './utils/token-counter';

// Scheduler
export { startBenchmarkScheduler } from './scheduler';