import { tokenCount } from '../../src/utils/token-counter';

describe('tokenCount', () => {
  test('returns 0 for empty string', () => {
    expect(tokenCount('')).toBe(0);
  });

  test('estimates 1 token per 4 characters for exact multiples', () => {
    expect(tokenCount('abcd')).toBe(1);
    expect(tokenCount('abcdefgh')).toBe(2);
    expect(tokenCount('a'.repeat(100))).toBe(25);
  });

  test('rounds up for non-multiples of 4', () => {
    expect(tokenCount('abc')).toBe(1);
    expect(tokenCount('abcde')).toBe(2);
    expect(tokenCount('abcdefghi')).toBe(3);
  });

  test('handles a single character', () => {
    expect(tokenCount('a')).toBe(1);
  });

  test('handles realistic prompt text', () => {
    const prompt = 'You are an AI assistant helping with code refactoring.';
    expect(tokenCount(prompt)).toBe(Math.ceil(prompt.length / 4));
  });
});
