import { GeminiProvider } from '../../src/providers/gemini-provider';
import { Message } from '../../src/phase1/orchestrator';
import { ToolSchema } from '../../src/phase2/tool-shed';

jest.mock('@google/generative-ai', () => {
  const actual = jest.requireActual<typeof import('@google/generative-ai')>('@google/generative-ai');
  const mockGenerateContent = jest.fn();
  const MockGoogleGenerativeAI = jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: mockGenerateContent,
    }),
  }));
  return {
    ...actual,
    GoogleGenerativeAI: MockGoogleGenerativeAI,
    __mockGenerateContent: mockGenerateContent,
  };
});

const { __mockGenerateContent: mockGenerateContent } =
  jest.requireMock<{ __mockGenerateContent: jest.Mock }>('@google/generative-ai');

describe('GeminiProvider callWithTools', () => {
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
    process.env.GOOGLE_API_KEY = 'test-google-key';
  });

  afterEach(() => {
    delete process.env.GOOGLE_API_KEY;
    jest.clearAllMocks();
  });

  test('callWithTools returns tool_calls when model calls functions', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        functionCalls: () => [
          { name: 'file_read', args: { path: 'README.md' } },
        ],
        text: () => { throw new Error('no text'); },
      },
    });

    const provider = new GeminiProvider();
    const result = await provider.callWithTools(
      [{ role: 'user', content: 'Read README.md' }],
      tools,
    );

    expect(result.type).toBe('tool_calls');
    if (result.type === 'tool_calls') {
      expect(result.tool_calls).toHaveLength(1);
      expect(result.tool_calls[0].name).toBe('file_read');
      expect(result.tool_calls[0].parameters).toEqual({ path: 'README.md' });
      expect(result.tool_calls[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    }
  });

  test('callWithTools returns text when model responds with text', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        functionCalls: () => undefined,
        text: () => 'Here is the answer.',
      },
    });

    const provider = new GeminiProvider();
    const result = await provider.callWithTools(
      [{ role: 'user', content: 'Give answer' }],
      tools,
    );

    expect(result).toEqual({ type: 'text', text: 'Here is the answer.' });
  });

  test('callWithTools handles multi-turn with tool results', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        functionCalls: () => undefined,
        text: () => 'I used the tool result.',
      },
    });

    const provider = new GeminiProvider();

    const messages: Message[] = [
      { role: 'user', content: 'Read file and summarize' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'tc_1', name: 'file_read', parameters: { path: 'README.md' } },
        ],
      },
      {
        role: 'tool',
        content: '',
        tool_results: [
          { tool_call_id: 'tc_1', content: 'README contents', is_error: false },
        ],
      },
    ];

    const result = await provider.callWithTools(messages, tools);
    expect(result).toEqual({ type: 'text', text: 'I used the tool result.' });

    // Verify generateContent was called with properly formatted contents
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const callArg = mockGenerateContent.mock.calls[0][0];
    expect(callArg.contents).toHaveLength(3);
    expect(callArg.contents[0]).toEqual({ role: 'user', parts: [{ text: 'Read file and summarize' }] });
    expect(callArg.contents[1]).toEqual({
      role: 'model',
      parts: [{ functionCall: { name: 'file_read', args: { path: 'README.md' } } }],
    });
    expect(callArg.contents[2]).toEqual({
      role: 'function',
      parts: [{
        functionResponse: {
          name: 'file_read',
          response: { content: 'README contents', is_error: false },
        },
      }],
    });
  });

  test('callWithTools handles empty function calls array', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        functionCalls: () => [],
        text: () => 'No tools needed.',
      },
    });

    const provider = new GeminiProvider();
    const result = await provider.callWithTools(
      [{ role: 'user', content: 'Hello' }],
      tools,
    );

    expect(result).toEqual({ type: 'text', text: 'No tools needed.' });
  });

  test('call still works as before', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => 'Hello from Gemini.',
      },
    });

    const provider = new GeminiProvider();
    const result = await provider.call('Hello');
    expect(result).toBe('Hello from Gemini.');
  });
});
