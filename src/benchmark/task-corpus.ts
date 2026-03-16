/**
 * Standard benchmark corpus for SOP coverage evaluation.
 * Includes realistic engineering scenarios across common task categories.
 */

export const STANDARD_TASK_CORPUS: string[] = [
  // bug fixes
  'Debug and fix an intermittent null pointer error in the order processing service that appears under high concurrency.',

  // feature additions
  'Add a new user-facing feature to export dashboard analytics as CSV with date-range filters.',

  // refactoring
  'Refactor the legacy billing module into smaller functions without changing behavior, then verify tests still pass.',

  // code review
  'Perform a pull-request code review for recent authentication changes and suggest improvements before merge.',

  // dependency upgrades
  'Upgrade the web framework dependency to the latest major version and resolve breaking API changes safely.',

  // database changes
  'Design and apply a database migration that adds a nullable status column to invoices and backfills existing rows.',

  // documentation
  'Write developer documentation for onboarding, local setup, and the release checklist for this repository.',

  // security audit
  'Run a security audit focused on secrets handling, input validation, and potential injection vulnerabilities.',

  // performance optimization
  'Optimize API response latency for the reporting endpoint by profiling bottlenecks and reducing expensive queries.',

  // deployment
  'Prepare and execute a production deployment plan with health checks, canary rollout, and rollback steps.',
];
