# Active Task

Implement the tool-calling loop — the agentic execution engine that makes EBA autonomous.

## Context

The full EBA chassis is built: memory, SOPs, threading, safety, retry logic, and session compression. The missing piece is the inner execution loop inside BlueprintOrchestrator. Currently, provider.call(prompt) returns a string — the LLM describes what to do but nothing applies it.

## What needs to be built

### 1. Extend the LLMProvider interface (src/phase1/orchestrator.ts)
Add a new method to the LLMProvider interface:
- callWithTools(messages: Message[], tools: ToolSchema[]): Promise<LLMResponse>
Where LLMResponse is either a TextResponse (done) or ToolCallResponse (model wants to call a tool).

### 2. Implement tool executors (src/phase2/tool-shed.ts)
Add an execute(toolName, params, cwd) method to ToolShed that runs the actual tool:
- read → fs.readFileSync
- write → fs.writeFileSync  
- search → child_process execSync with grep/rg
- execute → ShellTestRunner or child_process.exec
- analyze → pass-through string (LLM handles)

### 3. Implement tool-calling loop in BlueprintOrchestrator (src/phase1/orchestrator.ts)
Replace the single provider.call(prompt) with an agentic loop:
1. Build initial messages array from the task prompt
2. Call provider.callWithTools(messages, selectedTools)
3. If response is TextResponse → done, run tests
4. If response is ToolCallResponse → execute each tool call via ToolShed (after 3PM check), append results to messages, loop back to step 2
5. Repeat until text response or max_iterations reached

### 4. Update ClaudeProvider (src/providers/claude-provider.ts)
Implement callWithTools using Anthropic's tool_use API format.

### 5. Wire 3PM approval into tool execution
Before executing any tool call, call threePillarModel.classifyAction() to check risk level. Block or request approval for high-risk actions per the configured approvalMode.

## Acceptance criteria
- Agent can read a file, modify it, and verify the change with tests — all autonomously
- 3PM approval gates fire correctly for write/execute tools in strict mode
- All existing 195 tests still pass
- New tests cover the tool-calling loop and tool executors
