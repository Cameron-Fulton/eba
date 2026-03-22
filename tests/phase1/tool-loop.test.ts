import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  BlueprintOrchestrator,
  LLMProvider,
  TestRunner,
  Message,
  ToolCall,
  LLMResponse,
  TextResponse,
  ToolCallResponse,
} from '../../src/phase1/orchestrator';
import { ToolShed, ToolSchema, createDefaultToolShed } from '../../src/phase2/tool-shed';
import { ThreePillarModel } from '../../src/phase3/three-pillar-model';

function makeDirs(): { tempDir: string; docsDir: string; logsDir: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-loop-test-'));
  const docsDir = path.join(tempDir, 'docs');
  const logsDir = path.join(tempDir, 'logs');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  return { tempDir, docsDir, logsDir };
}

function makeOrch(
  llmProvider: LLMProvider,
  maxToolIterations: number = 10,
  threePillarModel?: ThreePillarModel
): { orch: BlueprintOrchestrator; docsDir: string; tempDir: string } {
  const { tempDir, docsDir, logsDir } = makeDirs();
  const testRunner: TestRunner = {
    run: jest.fn().mockResolvedValue({
      passed: true,
      output: 'ok',
      duration_ms: 1,
    }),
  };

  const orch = new BlueprintOrchestrator({
    docsDir,
    logsDir,
    maxRetries: 1,
    contextSaturationThreshold: 10000,
    llmProvider,
    testRunner,
    threePillarModel,
    maxToolIterations,
  });

  return { orch, docsDir, tempDir };
}

describe('LLMResponse types', () => {
  test('TextResponse has type text and text field', () => {
    const response: TextResponse = { type: 'text', text: 'hello' };
    expect(response.type).toBe('text');
    expect(response.text).toBe('hello');
  });

  test('ToolCallResponse has type tool_calls and tool_calls array', () => {
    const call: ToolCall = {
      id: 'tc-1',
      name: 'file_read',
      parameters: { path: '/tmp/example.txt' },
    };

    const response: ToolCallResponse = {
      type: 'tool_calls',
      tool_calls: [call],
    };

    expect(response.type).toBe('tool_calls');
    expect(response.tool_calls).toHaveLength(1);
  });
});

describe('executeWithToolLoop', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  test('throws when provider does not implement callWithTools', async () => {
    const provider: LLMProvider = {
      call: jest.fn().mockResolvedValue('unused'),
    };

    const { orch, tempDir } = makeOrch(provider);
    tempDirs.push(tempDir);

    const shed = createDefaultToolShed();
    const tools: ToolSchema[] = shed.getAll();

    await expect(orch.executeWithToolLoop('task', tools, shed)).rejects.toThrow(
      'LLMProvider does not implement callWithTools'
    );
  });

  test('returns immediately on TextResponse', async () => {
    const provider: LLMProvider = {
      call: jest.fn().mockResolvedValue('unused'),
      callWithTools: jest.fn().mockResolvedValue({ type: 'text', text: 'done' } as TextResponse),
    };

    const { orch, tempDir } = makeOrch(provider);
    tempDirs.push(tempDir);

    const shed: ToolShed = createDefaultToolShed();
    const tools: ToolSchema[] = shed.getAll();

    const result = await orch.executeWithToolLoop('task', tools, shed);

    expect(result.finalText).toBe('done');
    expect(result.iterations).toBe(1);
    expect(result.toolCallsMade).toEqual([]);
  });

  test('executes a tool call and feeds result back then receives text', async () => {
    const firstCall: ToolCall = {
      id: 'read-1',
      name: 'file_read',
      parameters: {},
    };

    const provider: LLMProvider = {
      call: jest.fn().mockResolvedValue('unused'),
      callWithTools: jest.fn(),
    };

    const { orch, tempDir } = makeOrch(provider);
    tempDirs.push(tempDir);

    const targetFile = path.join(tempDir, 'real-file.txt');
    fs.writeFileSync(targetFile, 'hello from file', 'utf-8');
    firstCall.parameters = { path: targetFile };

    let invocation = 0;
    (provider.callWithTools as jest.MockedFunction<
      (messages: Message[], tools: ToolSchema[]) => Promise<LLMResponse>
    >).mockImplementation(async (messages: Message[]) => {
      invocation += 1;
      if (invocation === 1) {
        return { type: 'tool_calls', tool_calls: [firstCall] };
      }

      const toolMessage = messages[messages.length - 1];
      expect(toolMessage.role).toBe('tool');
      expect(toolMessage.tool_results?.[0].is_error).toBe(false);
      expect(toolMessage.tool_results?.[0].content).toContain('hello from file');
      return { type: 'text', text: 'got the file' };
    });

    const shed = createDefaultToolShed(tempDir);
    const result = await orch.executeWithToolLoop('read this file', shed.getAll(), shed);

    expect(result.finalText).toBe('got the file');
    expect(result.iterations).toBe(2);
    expect(result.toolCallsMade).toHaveLength(1);
  });

  test('throws when max iterations exceeded', async () => {
    const provider: LLMProvider = {
      call: jest.fn().mockResolvedValue('unused'),
      callWithTools: jest.fn().mockResolvedValue({
        type: 'tool_calls',
        tool_calls: [
          {
            id: 'loop-read',
            name: 'file_read',
            parameters: { path: '/nonexistent' },
          },
        ],
      } as ToolCallResponse),
    };

    const { orch, tempDir } = makeOrch(provider, 3);
    tempDirs.push(tempDir);

    const shed = createDefaultToolShed();

    await expect(orch.executeWithToolLoop('loop forever', shed.getAll(), shed)).rejects.toThrow(
      'Tool loop exceeded max iterations (3)'
    );
  });

  test('3PM gate blocks denied write tools', async () => {
    const denied3PM = new ThreePillarModel(async () => false);
    denied3PM.registerActionClassification({ action: 'file_write', category: 'filesystem', risk_level: 'medium', requires_approval: true });

    const provider: LLMProvider = {
      call: jest.fn().mockResolvedValue('unused'),
      callWithTools: jest.fn(),
    };

    const { orch, tempDir } = makeOrch(provider, 10, denied3PM);
    tempDirs.push(tempDir);

    let invocation = 0;
    (provider.callWithTools as jest.MockedFunction<
      (messages: Message[], tools: ToolSchema[]) => Promise<LLMResponse>
    >).mockImplementation(async (messages: Message[]) => {
      invocation += 1;
      if (invocation === 1) {
        return {
          type: 'tool_calls',
          tool_calls: [
            {
              id: 'write-1',
              name: 'file_write',
              parameters: {
                path: path.join(tempDir, 'blocked.txt'),
                content: 'should not be written',
              },
            },
          ],
        };
      }

      const toolResult = messages[messages.length - 1].tool_results?.[0];
      expect(toolResult?.is_error).toBe(true);
      return { type: 'text', text: 'ok' };
    });

    const shed = createDefaultToolShed();
    const result = await orch.executeWithToolLoop('try write', shed.getAll(), shed, denied3PM);

    expect(result.finalText).toBe('ok');
  });

  test('3PM gate allows approved read tools', async () => {
    const default3PM = new ThreePillarModel();

    const provider: LLMProvider = {
      call: jest.fn().mockResolvedValue('unused'),
      callWithTools: jest.fn(),
    };

    const { orch, tempDir } = makeOrch(provider, 10, default3PM);
    tempDirs.push(tempDir);

    const readable = path.join(tempDir, 'readable.txt');
    fs.writeFileSync(readable, 'approved content', 'utf-8');

    let invocation = 0;
    (provider.callWithTools as jest.MockedFunction<
      (messages: Message[], tools: ToolSchema[]) => Promise<LLMResponse>
    >).mockImplementation(async (messages: Message[]) => {
      invocation += 1;
      if (invocation === 1) {
        return {
          type: 'tool_calls',
          tool_calls: [
            {
              id: 'read-approved',
              name: 'file_read',
              parameters: { path: readable },
            },
          ],
        };
      }

      const toolResult = messages[messages.length - 1].tool_results?.[0];
      if (toolResult?.content.includes('approved content')) {
        return { type: 'text', text: 'read ok' };
      }
      return { type: 'text', text: 'unexpected' };
    });

    const shed = createDefaultToolShed(tempDir);
    const result = await orch.executeWithToolLoop('read approved', shed.getAll(), shed, default3PM);

    expect(result.finalText).toBe('read ok');
  });

  test('multiple tool calls in one response are all executed', async () => {
    const provider: LLMProvider = {
      call: jest.fn().mockResolvedValue('unused'),
      callWithTools: jest.fn(),
    };

    const { orch, tempDir } = makeOrch(provider);
    tempDirs.push(tempDir);

    const fileA = path.join(tempDir, 'a.txt');
    const fileB = path.join(tempDir, 'b.txt');
    fs.writeFileSync(fileA, 'A', 'utf-8');
    fs.writeFileSync(fileB, 'B', 'utf-8');

    let invocation = 0;
    (provider.callWithTools as jest.MockedFunction<
      (messages: Message[], tools: ToolSchema[]) => Promise<LLMResponse>
    >).mockImplementation(async (messages: Message[]) => {
      invocation += 1;
      if (invocation === 1) {
        return {
          type: 'tool_calls',
          tool_calls: [
            { id: 'read-a', name: 'file_read', parameters: { path: fileA } },
            { id: 'read-b', name: 'file_read', parameters: { path: fileB } },
          ],
        };
      }

      const toolResults = messages[messages.length - 1].tool_results ?? [];
      if (toolResults.length === 2) {
        return { type: 'text', text: 'got 2 results' };
      }
      return { type: 'text', text: 'unexpected' };
    });

    const shed = createDefaultToolShed(tempDir);
    const result = await orch.executeWithToolLoop('read two files', shed.getAll(), shed);

    expect(result.toolCallsMade).toHaveLength(2);
    expect(result.finalText).toBe('got 2 results');
  });
});
