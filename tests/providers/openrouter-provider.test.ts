import OpenAI from 'openai';
import { OpenRouterProvider } from '../../src/providers/openrouter-provider';
import type { ModelRouterConfig } from '../../src/providers/model-router';

jest.mock('openai');

describe('OpenRouterProvider', () => {
  const MockedOpenAI = OpenAI as unknown as jest.Mock;
  const MODEL = 'deepseek/deepseek-r1:free';

  let mockCreate: jest.Mock;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key-or1234';

    mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'test response' } }],
      usage: {
        cost: 0.001,
        completion_tokens_details: { reasoning_tokens: 5 },
      },
    });

    MockedOpenAI.mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    }));
  });

  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  test('constructor throws if OPENROUTER_API_KEY is missing', () => {
    delete process.env.OPENROUTER_API_KEY;

    expect(() => new OpenRouterProvider(MODEL)).toThrow(
      'OPENROUTER_API_KEY environment variable is not set'
    );
  });

  test('constructor succeeds when OPENROUTER_API_KEY is set', () => {
    expect(() => new OpenRouterProvider(MODEL)).not.toThrow();

    expect(MockedOpenAI).toHaveBeenCalledWith({
      apiKey: 'test-key-or1234',
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/eba-project',
        'X-OpenRouter-Title': 'EBA',
      },
    });
  });

  test('call() sends request with the configured model and prompt', async () => {
    const provider = new OpenRouterProvider(MODEL);

    const result = await provider.call('hello world');

    expect(result).toBe('test response');
    expect(mockCreate).toHaveBeenCalledWith({
      model: MODEL,
      messages: [{ role: 'user', content: 'hello world' }],
      stream: false,
      max_tokens: 8096,
    });
  });

  test('call() logs cost and reasoning tokens when usage.cost is present', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const provider = new OpenRouterProvider(MODEL);

    await provider.call('measure usage');

    expect(logSpy).toHaveBeenCalledWith('[OpenRouter] cost=$0.001 reasoning_tokens=5');
  });

  test('call() throws a readable error when response has no content', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '' } }],
      usage: {
        cost: 0.001,
        completion_tokens_details: { reasoning_tokens: 5 },
      },
    });

    const provider = new OpenRouterProvider(MODEL);

    await expect(provider.call('no content please')).rejects.toThrow(
      'OpenRouter returned an empty response'
    );
  });

  test('call() remaps OpenRouter 502 provider errors to a retryable message', async () => {
    mockCreate.mockRejectedValueOnce({
      status: 502,
      message: 'Provider returned error from upstream',
    });

    const provider = new OpenRouterProvider(MODEL);

    await expect(provider.call('trigger 502')).rejects.toThrow(
      'OpenRouter upstream failure (retryable): Provider returned error (502)'
    );
  });

  test('toConsortiumProvider() returns openrouter model name and callable function', async () => {
    const provider = new OpenRouterProvider(MODEL);

    const consortiumProvider = provider.toConsortiumProvider();

    expect(consortiumProvider.name).toBe(`openrouter:${MODEL}`);
    expect(typeof consortiumProvider.call).toBe('function');

    const response = await consortiumProvider.call('consortium prompt');
    expect(response).toBe('test response');
  });

  test('ModelRouterConfig type accepts openrouter as primary', () => {
    const config: ModelRouterConfig = {
      primary: 'openrouter',
      enableConsortium: true,
    };

    expect(config.primary).toBe('openrouter');
  });
});
