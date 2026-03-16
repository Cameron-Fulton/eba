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