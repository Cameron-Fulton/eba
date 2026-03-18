import { runBenchmark } from '../../src/benchmark/run-benchmark';
import { SOPCoverageBenchmark, type BenchmarkResult } from '../../src/benchmark/sop-coverage';

describe('runBenchmark', () => {
  beforeEach(() => {
    jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);

    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('completes without calling process.exit when coverage score meets threshold', () => {
    const exitSpy = jest.spyOn(process, 'exit');

    expect(() => runBenchmark()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('logs expected benchmark output headers', () => {
    const logSpy = jest.spyOn(console, 'log');

    runBenchmark();

    const output = logSpy.mock.calls.map(args => args.join(' ')).join('\n');
    expect(output).toContain('📏 SOP Coverage Benchmark');
    expect(output).toContain('Registered SOPs:');
    expect(output).toContain('Results:');
    expect(output).toContain('Task breakdown:');
  });

  test('exits with code 1 when coverage score is below threshold', () => {
    jest.spyOn(SOPCoverageBenchmark.prototype, 'run').mockReturnValue({
      score: 0.4,
      covered: 4,
      total: 10,
      breakdown: [{ task: 'low-score task', matched_sop: null, confidence: 0.2 }],
    } as BenchmarkResult);

    const exitSpy = jest.spyOn(process, 'exit');
    const errorSpy = jest.spyOn(console, 'error');

    expect(() => runBenchmark()).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('below threshold 0.5'));
  });

  test('exits with code 2 when benchmark execution throws', () => {
    jest.spyOn(SOPCoverageBenchmark.prototype, 'run').mockImplementation(() => {
      throw new Error('boom');
    });

    const exitSpy = jest.spyOn(process, 'exit');
    const errorSpy = jest.spyOn(console, 'error');

    expect(() => runBenchmark()).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(errorSpy).toHaveBeenCalledWith('Benchmark failed:', expect.any(Error));
  });

  test('logs uncovered task count when unmatched tasks exist', () => {
    jest.spyOn(SOPCoverageBenchmark.prototype, 'run').mockReturnValue({
      score: 0.75,
      covered: 3,
      total: 4,
      breakdown: [
        { task: 'matched one', matched_sop: 'sop-a', confidence: 0.91 },
        { task: 'unmatched one', matched_sop: null, confidence: 0.11 },
        { task: 'matched two', matched_sop: 'sop-b', confidence: 0.87 },
        { task: 'matched three', matched_sop: 'sop-c', confidence: 0.85 },
      ],
    } as BenchmarkResult);

    const logSpy = jest.spyOn(console, 'log');

    runBenchmark();

    expect(logSpy).toHaveBeenCalledWith('\nUncovered task count:', 1);
  });
});
