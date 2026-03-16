/**
 * Token Counter Utility
 * Estimates token count using the heuristic of approximately 1 token per 4 characters.
 */

/**
 * Estimates the number of tokens in a given string.
 * Uses the heuristic of approximately 1 token per 4 characters.
 * @param text - The input string to estimate tokens for
 * @returns Estimated token count (rounded up)
 */
export function tokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}
