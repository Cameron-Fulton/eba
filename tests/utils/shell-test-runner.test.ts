import { retryWithBackoff } from '../../src/utils/shell-test-runner';

describe('retryWithBackoff', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('succeeds on first attempt (no retries needed)', async () => {
    const operation = jest.fn().mockResolvedValue('success');

    const result = await retryWithBackoff(operation);

    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  test('retries on failure then succeeds', async () => {
    const operation = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error('first failure'))
      .mockRejectedValueOnce(new Error('second failure'))
      .mockResolvedValueOnce('eventual success');

    const result = await retryWithBackoff(operation, {
      maxAttempts: 3,
      baseDelayMs: 0,
      multiplier: 2,
    });

    expect(result).toBe('eventual success');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  test('throws after all attempts exhausted', async () => {
    const lastError = new Error('always fails');
    const operation = jest
      .fn<Promise<string>, []>()
      .mockRejectedValue(lastError);

    await expect(
      retryWithBackoff(operation, {
        maxAttempts: 3,
        baseDelayMs: 0,
      })
    ).rejects.toThrow('always fails');

    expect(operation).toHaveBeenCalledTimes(3);
  });

  test('backoff delay doubles between retries', async () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    const operation = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValueOnce('ok');

    const promise = retryWithBackoff(operation, {
      maxAttempts: 3,
      baseDelayMs: 100,
      multiplier: 2,
    });

    await Promise.resolve();
    expect(setTimeoutSpy).toHaveBeenNthCalledWith(1, expect.any(Function), 100);

    await jest.advanceTimersByTimeAsync(100);
    expect(setTimeoutSpy).toHaveBeenNthCalledWith(2, expect.any(Function), 200);

    await jest.advanceTimersByTimeAsync(200);
    await expect(promise).resolves.toBe('ok');
  });

  test('returns correct value on success', async () => {
    const expected = { id: 'abc-123', status: 'done' };
    const operation = jest.fn().mockResolvedValue(expected);

    const result = await retryWithBackoff(operation);

    expect(result).toEqual(expected);
  });
});
