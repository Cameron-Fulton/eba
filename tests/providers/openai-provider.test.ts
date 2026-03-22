import OpenAI from 'openai';
import { OpenAIProvider } from '../../src/providers/openai-provider';
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

describe('OpenAIProvider callWithTools', () => {
  const MockedOpenAI = OpenAI as unknown as jest.Mock;
  let mockCreate: jest.Mock;

  const tools: ToolSchema[] = [
    {
      name: 'file_read',
      description: 'Read a file',
      category: 'read',
      risk_level: 'low',
      parameters: [
        { name: 'path', type: 'string', required: true, description: 'Path to read' },
      ],
    },
  ];

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-openai-key';

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
    delete process.env.OPENAI_API_KEY;
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  test('callWithTools returns tool_calls when model requests tools', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'file_read',
                  arguments: '{"path":"README.md"}',
                },
              },
            ],
          },
        },
      ],
    });

    const provider = new OpenAIProvider();
    const result = await provider.callWithTools(
      [{ role: 'user', content: 'Read README.md' }],
      tools,
    );

    expect(result).toEqual({
      type: 'tool_calls',
      tool_calls: [
        {
          id: 'call_1',
          name: 'file_read',
          parameters: { path: 'README.md' },
        },
      ],
    });

    expect(mockCreate).toHaveBeenCalledWith({
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'Read README.md' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'file_read',
            description: 'Read a file',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'Path to read' },
              },
              required: ['path'],
            },
          },
        },
      ],
      stream: false,
      max_tokens: 8192,
    });
  });

  test('callWithTools returns text when model responds with text', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: 'Here is the answer.',
          },
        },
      ],
    });

    const provider = new OpenAIProvider();
    const result = await provider.callWithTools(
      [{ role: 'user', content: 'Give answer' }],
      tools,
    );

    expect(result).toEqual({ type: 'text', text: 'Here is the answer.' });
  });

  test('callWithTools handles multi-turn with prior tool results fed back correctly', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: 'I used the tool result.',
          },
        },
      ],
    });

    const provider = new OpenAIProvider();

    const messages: Message[] = [
      { role: 'user', content: 'Read file and summarize' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'tc_1',
            name: 'file_read',
            parameters: { path: 'README.md' },
          },
        ],
      },
      {
        role: 'tool',
        content: '',
        tool_results: [
          {
            tool_call_id: 'tc_1',
            content: 'README file contents',
            is_error: false,
          },
        ],
      },
    ];

    const result = await provider.callWithTools(messages, tools);

    expect(result).toEqual({ type: 'text', text: 'I used the tool result.' });

    expect(mockCreate).toHaveBeenCalledWith({
      model: 'gpt-5.4',
      messages: [
        { role: 'user', content: 'Read file and summarize' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'tc_1',
              type: 'function',
              function: {
                name: 'file_read',
                arguments: '{"path":"README.md"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'tc_1',
          content: 'README file contents',
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'file_read',
            description: 'Read a file',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'Path to read' },
              },
              required: ['path'],
            },
          },
        },
      ],
      stream: false,
      max_tokens: 8192,
    });
  });
});
