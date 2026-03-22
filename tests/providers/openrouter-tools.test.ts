import OpenAI from 'openai';
import { OpenRouterProvider } from '../../src/providers/openrouter-provider';
import { Message } from '../../src/phase1/orchestrator';
import { ToolSchema } from '../../src/phase2/tool-shed';

jest.mock('openai', () => {
  const actual = jest.requireActual<typeof import('openai')>('openai');
  const MockedOpenAI = jest.fn();
  return {
    ...actual,
    __esModule: true,
    default: MockedOpenAI,
  };
});

describe('OpenRouterProvider.callWithTools', () => {
  const MockedOpenAI = OpenAI as unknown as jest.Mock;
  const MODEL = 'openrouter/test-model';

  let mockCreate: jest.Mock;

  const tools: ToolSchema[] = [
    {
      name: 'grep_search',
      description: 'Search files for a pattern',
      category: 'search',
      parameters: [
        { name: 'pattern', type: 'string', required: true, description: 'Pattern to search for' },
        { name: 'path', type: 'string', required: false, description: 'Path to search' },
      ],
      risk_level: 'low',
    },
  ];

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockCreate = jest.fn();

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

  test('callWithTools returns tool_calls when model requests tools', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [
              {
                id: 'toolu_1',
                type: 'function',
                function: {
                  name: 'grep_search',
                  arguments: '{"pattern":"TODO","path":"src"}',
                },
              },
            ],
          },
        },
      ],
      usage: {
        cost: 0.001,
        completion_tokens_details: { reasoning_tokens: 3 },
      },
    });

    const provider = new OpenRouterProvider(MODEL);
    const response = await provider.callWithTools([{ role: 'user', content: 'Find TODOs' }], tools);

    expect(response).toEqual({
      type: 'tool_calls',
      tool_calls: [
        {
          id: 'toolu_1',
          name: 'grep_search',
          parameters: { pattern: 'TODO', path: 'src' },
        },
      ],
    });

    expect(mockCreate).toHaveBeenCalledWith({
      model: MODEL,
      messages: [{ role: 'user', content: 'Find TODOs' }],
      stream: false,
      max_tokens: 8192,
      tools: [
        {
          type: 'function',
          function: {
            name: 'grep_search',
            description: 'Search files for a pattern',
            parameters: {
              type: 'object',
              properties: {
                pattern: { type: 'string', description: 'Pattern to search for' },
                path: { type: 'string', description: 'Path to search' },
              },
              required: ['pattern'],
            },
          },
        },
      ],
    });
  });

  test('callWithTools returns text when model responds with text', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: 'All done',
          },
        },
      ],
    });

    const provider = new OpenRouterProvider(MODEL);
    const response = await provider.callWithTools([{ role: 'user', content: 'Respond normally' }], tools);

    expect(response).toEqual({ type: 'text', text: 'All done' });
  });

  test("tool results are correctly formatted as role:'tool' messages", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: 'Processed tool result',
          },
        },
      ],
    });

    const provider = new OpenRouterProvider(MODEL);

    const messages: Message[] = [
      { role: 'user', content: 'Use tools' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'toolu_1', name: 'grep_search', parameters: { pattern: 'TODO', path: 'src' } }],
      },
      {
        role: 'tool',
        content: '',
        tool_results: [{ tool_call_id: 'toolu_1', content: 'match at src/file.ts:1', is_error: false }],
      },
    ];

    await provider.callWithTools(messages, tools);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: 'user', content: 'Use tools' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'toolu_1',
                type: 'function',
                function: {
                  name: 'grep_search',
                  arguments: '{"pattern":"TODO","path":"src"}',
                },
              },
            ],
          },
          {
            role: 'tool',
            tool_call_id: 'toolu_1',
            content: 'match at src/file.ts:1',
          },
        ],
      }),
    );
  });
});
