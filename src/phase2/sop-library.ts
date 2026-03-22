/**
 * Phase 2: SOP Library
 * Reusable SOP factory functions for common engineering workflows.
 */

import { SOPDefinition } from './sop';

/** Bug fixing workflow with guarded modification step. */
export function createBugFixSOP(): SOPDefinition {
  return {
    id: 'bug_fix',
    name: 'Standard Bug Fix Workflow',
    description: 'Reproduce the issue, diagnose root cause, patch safely, and verify the fix',
    initial_step: 'reproduce',
    steps: [
      {
        id: 'reproduce',
        name: 'Reproduce Issue',
        description: 'Reproduce the bug and collect evidence about the failing behavior',
        allowed_tool_categories: ['read', 'search', 'analyze'],
        next_steps: ['diagnose'],
      },
      {
        id: 'diagnose',
        name: 'Diagnose Root Cause',
        description: 'Analyze the code paths and identify the root cause of the bug',
        allowed_tool_categories: ['read', 'search', 'analyze'],
        next_steps: ['patch'],
      },
      {
        id: 'patch',
        name: 'Patch Implementation',
        description: 'Implement the minimal safe code changes required to fix the root cause',
        allowed_tool_categories: ['read', 'write', 'search'],
        next_steps: ['verify'],
        requires_approval: true,
      },
      {
        id: 'verify',
        name: 'Verify Fix',
        description: 'Run validation checks and tests to confirm the bug is resolved',
        allowed_tool_categories: ['read', 'execute'],
        next_steps: ['diagnose', 'patch', 'complete'],
      },
      {
        id: 'complete',
        name: 'Complete',
        description: 'Bug fix is validated and ready to finalize',
        allowed_tool_categories: ['read'],
        next_steps: [],
      },
    ],
  };
}

/** Feature delivery workflow from specification to documentation. */
export function createFeatureSOP(): SOPDefinition {
  return {
    id: 'feature',
    name: 'Standard Feature Implementation Workflow',
    description: 'Add a new feature: define requirements, scaffold structure, implement, test behavior, and document outcomes',
    initial_step: 'spec',
    steps: [
      {
        id: 'spec',
        name: 'Define Specification',
        description: 'Clarify requirements, constraints, and expected behavior for the feature',
        allowed_tool_categories: ['read', 'search', 'analyze'],
        next_steps: ['scaffold'],
      },
      {
        id: 'scaffold',
        name: 'Scaffold Structure',
        description: 'Create the initial structure and files needed for the feature implementation',
        allowed_tool_categories: ['read', 'write'],
        next_steps: ['build'],
      },
      {
        id: 'build',
        name: 'Build Feature',
        description: 'Implement feature logic across relevant modules',
        allowed_tool_categories: ['read', 'write', 'search'],
        next_steps: ['test'],
      },
      {
        id: 'test',
        name: 'Test Feature',
        description: 'Execute tests and checks to verify feature correctness',
        allowed_tool_categories: ['read', 'execute'],
        next_steps: ['build', 'document'],
      },
      {
        id: 'document',
        name: 'Document Changes',
        description: 'Update docs, usage notes, and implementation details for maintainers',
        allowed_tool_categories: ['read', 'write'],
        next_steps: ['complete'],
      },
      {
        id: 'complete',
        name: 'Complete',
        description: 'Feature is implemented, tested, and documented',
        allowed_tool_categories: ['read'],
        next_steps: [],
      },
    ],
  };
}

/** Code review workflow for evaluating a change set and producing a written report. */
export function createCodeReviewSOP(): SOPDefinition {
  return {
    id: 'code_review',
    name: 'Standard Code Review Workflow',
    description: 'Inspect the change set, analyze quality, and produce a review report',
    initial_step: 'checkout',
    steps: [
      {
        id: 'checkout',
        name: 'Checkout and Context Gathering',
        description: 'Load the change set and gather relevant context for review',
        allowed_tool_categories: ['read', 'search'],
        next_steps: ['analyze'],
      },
      {
        id: 'analyze',
        name: 'Analyze Change Set',
        description: 'Evaluate correctness, design quality, risks, and maintainability',
        allowed_tool_categories: ['read', 'search', 'analyze'],
        next_steps: ['report'],
      },
      {
        id: 'report',
        name: 'Write Review Report',
        description: 'Write a structured review report including findings and recommendations',
        allowed_tool_categories: ['read', 'write'],
        next_steps: ['complete'],
      },
      {
        id: 'complete',
        name: 'Complete',
        description: 'Code review is finalized and report is complete',
        allowed_tool_categories: ['read'],
        next_steps: [],
      },
    ],
  };
}

/** Dependency upgrade workflow with explicit approval before running updates. */
export function createDependencyUpgradeSOP(): SOPDefinition {
  return {
    id: 'dependency_upgrade',
    name: 'Standard Dependency Upgrade Workflow',
    description: 'Audit current dependencies, apply upgrades, and validate compatibility and stability',
    initial_step: 'audit',
    steps: [
      {
        id: 'audit',
        name: 'Audit Dependencies',
        description: 'Inspect current dependency versions, advisories, and upgrade scope',
        allowed_tool_categories: ['read', 'search', 'analyze'],
        next_steps: ['update'],
      },
      {
        id: 'update',
        name: 'Apply Dependency Updates',
        description: 'Run package manager commands and update dependency definitions',
        allowed_tool_categories: ['read', 'write', 'execute'],
        next_steps: ['test'],
        requires_approval: true,
      },
      {
        id: 'test',
        name: 'Run Tests',
        description: 'Execute automated checks to detect regressions after dependency changes',
        allowed_tool_categories: ['read', 'execute'],
        next_steps: ['update', 'validate'],
      },
      {
        id: 'validate',
        name: 'Validate Runtime and Integration',
        description: 'Analyze compatibility, breaking changes, and integration impact',
        allowed_tool_categories: ['read', 'search', 'analyze'],
        next_steps: ['update', 'complete'],
      },
      {
        id: 'complete',
        name: 'Complete',
        description: 'Dependency upgrade is validated and ready to finalize',
        allowed_tool_categories: ['read'],
        next_steps: [],
      },
    ],
  };
}

/** Deployment workflow with explicit approval for deployment execution. */
export function createDeploymentSOP(): SOPDefinition {
  return {
    id: 'deployment',
    name: 'Standard Deployment Workflow',
    description: 'Plan, prepare, execute, and validate a production deployment with rollback awareness',
    initial_step: 'plan',
    steps: [
      {
        id: 'plan',
        name: 'Plan Deployment',
        description: 'Review rollout strategy, risks, dependencies, and validation criteria',
        allowed_tool_categories: ['read', 'search', 'analyze'],
        next_steps: ['prepare'],
      },
      {
        id: 'prepare',
        name: 'Prepare Artifacts and Config',
        description: 'Build deployment artifacts and update required configuration for release',
        allowed_tool_categories: ['read', 'write', 'search'],
        next_steps: ['deploy'],
      },
      {
        id: 'deploy',
        name: 'Execute Deployment',
        description: 'Run deployment commands to release the prepared version',
        allowed_tool_categories: ['read', 'execute'],
        next_steps: ['validate'],
        requires_approval: true,
      },
      {
        id: 'validate',
        name: 'Validate Deployment',
        description: 'Run health checks, smoke tests, and analyze signals to verify release health',
        allowed_tool_categories: ['read', 'search', 'analyze', 'execute'],
        next_steps: ['deploy', 'complete'],
      },
      {
        id: 'complete',
        name: 'Complete',
        description: 'Deployment is validated and complete',
        allowed_tool_categories: ['read'],
        next_steps: [],
      },
    ],
  };
}

/** Database migration workflow with explicit approval before schema changes. */
export function createDatabaseMigrationSOP(): SOPDefinition {
  return {
    id: 'database_migration',
    name: 'Standard Database Migration Workflow',
    description: 'Design, apply, and validate a database schema migration with safe rollback awareness',
    initial_step: 'design',
    steps: [
      {
        id: 'design',
        name: 'Design Migration',
        description: 'Define the schema changes, migration script, backfill strategy, and rollback plan',
        allowed_tool_categories: ['read', 'search', 'analyze'],
        next_steps: ['review'],
      },
      {
        id: 'review',
        name: 'Review Migration Plan',
        description: 'Validate the migration script for correctness, safety, and reversibility',
        allowed_tool_categories: ['read', 'analyze'],
        next_steps: ['apply'],
      },
      {
        id: 'apply',
        name: 'Apply Migration',
        description: 'Execute the migration script against the target database',
        allowed_tool_categories: ['read', 'execute'],
        next_steps: ['verify'],
        requires_approval: true,
      },
      {
        id: 'verify',
        name: 'Verify Migration',
        description: 'Run checks to confirm schema changes are correct and data integrity is preserved',
        allowed_tool_categories: ['read', 'execute', 'analyze'],
        next_steps: ['apply', 'complete'],
      },
      {
        id: 'complete',
        name: 'Complete',
        description: 'Database migration is applied and verified',
        allowed_tool_categories: ['read'],
        next_steps: [],
      },
    ],
  };
}

/** Documentation workflow for writing and publishing developer docs. */
export function createDocumentationSOP(): SOPDefinition {
  return {
    id: 'documentation',
    name: 'Standard Documentation Workflow',
    description: 'Research, write, review, and publish developer documentation including onboarding guides and release checklists',
    initial_step: 'research',
    steps: [
      {
        id: 'research',
        name: 'Research and Outline',
        description: 'Gather context, identify audience, and create documentation outline',
        allowed_tool_categories: ['read', 'search', 'analyze'],
        next_steps: ['draft'],
      },
      {
        id: 'draft',
        name: 'Draft Documentation',
        description: 'Write the documentation content including setup instructions, usage examples, and checklists',
        allowed_tool_categories: ['read', 'write', 'search'],
        next_steps: ['review'],
      },
      {
        id: 'review',
        name: 'Review and Refine',
        description: 'Review for accuracy, completeness, and clarity; incorporate feedback',
        allowed_tool_categories: ['read', 'write', 'analyze'],
        next_steps: ['draft', 'publish'],
      },
      {
        id: 'publish',
        name: 'Publish Documentation',
        description: 'Commit and publish the finalized documentation to the appropriate location',
        allowed_tool_categories: ['read', 'write', 'execute'],
        next_steps: ['complete'],
      },
      {
        id: 'complete',
        name: 'Complete',
        description: 'Documentation is written, reviewed, and published',
        allowed_tool_categories: ['read'],
        next_steps: [],
      },
    ],
  };
}

/** Security audit workflow for identifying and remediating vulnerabilities. */
export function createSecurityAuditSOP(): SOPDefinition {
  return {
    id: 'security_audit',
    name: 'Standard Security Audit Workflow',
    description: 'Audit the codebase for security vulnerabilities including secrets handling, input validation, and injection risks',
    initial_step: 'scope',
    steps: [
      {
        id: 'scope',
        name: 'Define Audit Scope',
        description: 'Identify the components, threat surfaces, and security concerns to audit',
        allowed_tool_categories: ['read', 'search', 'analyze'],
        next_steps: ['audit'],
      },
      {
        id: 'audit',
        name: 'Run Security Audit',
        description: 'Inspect code for vulnerabilities: secrets exposure, injection vectors, input validation gaps, and unsafe patterns',
        allowed_tool_categories: ['read', 'search', 'analyze', 'execute'],
        next_steps: ['report'],
      },
      {
        id: 'report',
        name: 'Produce Security Report',
        description: 'Document findings with severity ratings, affected components, and recommended remediations',
        allowed_tool_categories: ['read', 'write', 'analyze'],
        next_steps: ['remediate', 'complete'],
      },
      {
        id: 'remediate',
        name: 'Remediate Findings',
        description: 'Apply fixes for identified vulnerabilities and verify remediations are effective',
        allowed_tool_categories: ['read', 'write', 'execute'],
        next_steps: ['audit', 'complete'],
        requires_approval: true,
      },
      {
        id: 'complete',
        name: 'Complete',
        description: 'Security audit is finished and findings are documented or remediated',
        allowed_tool_categories: ['read'],
        next_steps: [],
      },
    ],
  };
}

/** Performance optimization workflow for profiling and improving system performance. */
export function createPerformanceOptimizationSOP(): SOPDefinition {
  return {
    id: 'performance_optimization',
    name: 'Standard Performance Optimization Workflow',
    description: 'Profile the system to identify bottlenecks, implement targeted optimizations, and validate latency and throughput improvements',
    initial_step: 'profile',
    steps: [
      {
        id: 'profile',
        name: 'Profile and Measure',
        description: 'Measure current performance baselines and identify bottlenecks using profiling tools',
        allowed_tool_categories: ['read', 'execute', 'analyze'],
        next_steps: ['analyze'],
      },
      {
        id: 'analyze',
        name: 'Analyze Bottlenecks',
        description: 'Identify root causes of performance issues including slow queries, memory pressure, and inefficient algorithms',
        allowed_tool_categories: ['read', 'search', 'analyze'],
        next_steps: ['optimize'],
      },
      {
        id: 'optimize',
        name: 'Implement Optimizations',
        description: 'Apply targeted code changes to reduce latency, improve throughput, and eliminate bottlenecks',
        allowed_tool_categories: ['read', 'write', 'search'],
        next_steps: ['validate'],
      },
      {
        id: 'validate',
        name: 'Validate Improvements',
        description: 'Re-run performance measurements to confirm improvements and check for regressions',
        allowed_tool_categories: ['read', 'execute', 'analyze'],
        next_steps: ['optimize', 'complete'],
      },
      {
        id: 'complete',
        name: 'Complete',
        description: 'Performance optimizations are implemented and validated',
        allowed_tool_categories: ['read'],
        next_steps: [],
      },
    ],
  };
}

export function createInfrastructureProbeSOP(): SOPDefinition {
  return {
    id: 'infrastructure_probe',
    name: 'Infrastructure & System Probe Workflow',
    description: 'Exploratory audit, system analysis, directory mapping, and infrastructure investigation tasks. Uses shell access and produces a validation report rather than passing tests.',
    initial_step: 'build_scenario_profile',
    steps: [
      {
        id: 'build_scenario_profile',
        name: 'Build Scenario Profile',
        description: 'Map the system, service, or directory structure being investigated. Understand scope and boundaries.',
        allowed_tool_categories: ['read', 'search', 'execute'],
        allowed_tools: ['file_read', 'glob_find', 'grep_search', 'bash_execute', 'code_analyzer'],
        requires_approval: false,
        next_steps: ['research'],
      },
      {
        id: 'research',
        name: 'Research & Context Gathering',
        description: 'Check existing documentation, prior findings, architecture guides, or system logs relevant to the probe.',
        allowed_tool_categories: ['read', 'search'],
        allowed_tools: ['file_read', 'glob_find', 'grep_search'],
        requires_approval: false,
        next_steps: ['create_probe'],
      },
      {
        id: 'create_probe',
        name: 'Create Validation Probe',
        description: 'Write a probe script (probe_script.sh) or structured query plan that will surface the information needed. For directory audits, map structure. For services, write connectivity/health checks.',
        allowed_tool_categories: ['read', 'search', 'write', 'execute'],
        allowed_tools: ['file_read', 'file_write', 'file_edit', 'glob_find', 'grep_search', 'bash_execute'],
        requires_approval: false,
        next_steps: ['execute_and_document'],
      },
      {
        id: 'execute_and_document',
        name: 'Execute and Document Findings',
        description: 'Run the probe, iterate on failures, and document all discovered issues, structures, and anomalies into pitfalls.md and a running findings log.',
        allowed_tool_categories: ['read', 'search', 'write', 'execute'],
        allowed_tools: ['file_read', 'file_write', 'file_edit', 'glob_find', 'grep_search', 'bash_execute', 'code_analyzer'],
        requires_approval: false,
        next_steps: ['deliver_context_bundle'],
      },
      {
        id: 'deliver_context_bundle',
        name: 'Deliver Context Bundle',
        description: 'Produce the final validation_report.md and pitfalls.md. Summarise all findings, recommendations, and next steps for the orchestrator.',
        allowed_tool_categories: ['read', 'write'],
        allowed_tools: ['file_read', 'file_write', 'file_edit'],
        requires_approval: false,
        next_steps: ['complete'],
      },
      {
        id: 'complete',
        name: 'Complete',
        description: 'Probe complete. Validation report and pitfalls document delivered.',
        allowed_tool_categories: ['read'],
        allowed_tools: [],
        requires_approval: false,
        next_steps: [],
      },
    ],
  };
}