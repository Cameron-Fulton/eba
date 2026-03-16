# Active Task

Add a utility function `retryWithBackoff` to `src/utils/shell-test-runner.ts` that wraps any async operation with exponential backoff retry logic (max 3 attempts, base delay 500ms, multiplier 2x). Write a corresponding test in `tests/utils/shell-test-runner.test.ts` that verifies the retry behavior using mocks. Run `npm test` to confirm all tests pass.
