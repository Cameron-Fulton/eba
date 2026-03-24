/**
 * Prompt Enhancer
 * Wraps an LLMProvider to transparently inject context into every prompt:
 *   - Negative knowledge: past failures relevant to this task
 *   - SOP step: the current workflow position and allowed tools
 *   - Tool schemas: the 2-3 most relevant tools for this task
 *
 * This keeps the orchestrator untouched while giving it full context.
 */

import { LLMProvider, Message, LLMResponse } from '../phase1/orchestrator';
import { NegativeKnowledgeStore, NegativeKnowledgeEntry } from '../phase1/negative-knowledge';
import { SOPEngine } from '../phase2/sop';
import { ToolShed, ToolSchema } from '../phase2/tool-shed';

export interface PromptEnhancerConfig {
  provider:         LLMProvider;
  negativeKnowledge: NegativeKnowledgeStore;
  sop:              SOPEngine;
  toolShed:         ToolShed;
  /** Max number of negative knowledge entries to inject (default: 5) */
  maxNkEntries?:    number;
  /** Max number of tools to inject (default: 3) */
  maxTools?:        number;
  /** Project context from ContextDiscovery, injected at prompt start */
  projectContext?: string;
  /** Project-specific NK store for project-first search */
  projectNegativeKnowledge?: NegativeKnowledgeStore;
}

export class PromptEnhancer implements LLMProvider {
  private config: PromptEnhancerConfig;
  private injectedNkEntries: NegativeKnowledgeEntry[] = [];
  callWithTools?: (messages: Message[], tools: ToolSchema[]) => Promise<LLMResponse>;

  constructor(config: PromptEnhancerConfig) {
    this.config = config;

    // Only expose callWithTools when the underlying provider supports it
    if (config.provider.callWithTools) {
      this.callWithTools = async (messages: Message[], tools: ToolSchema[]): Promise<LLMResponse> => {
        let lastUserIndex = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'user' && typeof messages[i].content === 'string') {
            lastUserIndex = i;
            break;
          }
        }

        const enhancedMessages = messages.map((message, index) => {
          if (index === lastUserIndex && message.role === 'user' && typeof message.content === 'string') {
            return { ...message, content: this.enhance(message.content) };
          }
          return message;
        });

        return config.provider.callWithTools!(enhancedMessages, tools);
      };
    }
  }

  async call(prompt: string): Promise<string> {
    const enhanced = this.enhance(prompt);
    return this.config.provider.call(enhanced);
  }

  enhance(prompt: string): string {
    const sections: string[] = [];

    // --- 0. Project context (highest priority, placed first) ---
    if (this.config.projectContext) {
      sections.push('## Project Context\n' + this.config.projectContext);
    }

    // --- 1. SOP context ---
    const step = this.config.sop.getCurrentStep();
    if (step) {
      sections.push([
        '## Current Workflow Step',
        `Step: ${step.name} — ${step.description}`,
        `Allowed tool categories: ${step.allowed_tool_categories.join(', ')}`,
        step.allowed_tools ? `Allowed tools: ${step.allowed_tools.join(', ')}` : '',
      ].filter(Boolean).join('\n'));
    }

    // --- 2. Relevant tools from the Tool Shed ---
    const maxTools = this.config.maxTools ?? 3;
    const selectedTools = this.config.toolShed.selectTools(prompt, maxTools);
    if (selectedTools.length > 0) {
      const toolLines = selectedTools.map(t =>
        `- ${t.name} [${t.category}, risk:${t.risk_level}]: ${t.description}`
      );
      sections.push(['## Available Tools', ...toolLines].join('\n'));
    }

    // --- 3. Negative knowledge: known failures for this task ---
    const maxNk = this.config.maxNkEntries ?? 5;
    // Extract key terms from the prompt for searching
    const keyTerms = prompt
      .split(/\s+/)
      .filter(w => w.length > 4)
      .slice(0, 10)
      .join(' ');
    // Project-first search: project entries fill first, global fills remaining
    let nkEntries: NegativeKnowledgeEntry[] = [];
    if (this.config.projectNegativeKnowledge) {
      nkEntries = this.config.projectNegativeKnowledge.searchByKeyword(keyTerms).slice(0, maxNk);
    }
    const remainingSlots = maxNk - nkEntries.length;
    if (remainingSlots > 0) {
      const globalEntries = this.config.negativeKnowledge.searchByKeyword(keyTerms).slice(0, remainingSlots);
      nkEntries = [...nkEntries, ...globalEntries];
    }
    this.injectedNkEntries = [...nkEntries];

    if (nkEntries.length > 0) {
      const sanitize = (s: string) => s
        // Strip markdown headers that could create new prompt sections
        .replace(/^#{1,6} /gm, '')
        // Strip bold/italic markdown
        .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
        // Strip lines that start with common prompt injection keywords
        .replace(/^(ignore|disregard|forget|system|assistant|user|human|\[INST\]|<\/?s>).*/gim, '[filtered]')
        // Truncate to reasonable max length per field
        .slice(0, 500)
        .trim();
      const failureLines = nkEntries.map(f =>
        `- Scenario: ${sanitize(f.scenario)}\n  Failed approach: ${sanitize(f.attempt)}\n  Why it failed: ${sanitize(f.outcome)}\n  What works: ${sanitize(f.solution)}`
      );
      sections.push([
        '## ⚠️ Known Failures — Do NOT repeat these approaches',
        ...failureLines,
      ].join('\n'));
    }
    // --- 4. Append original prompt ---
    sections.push('## Task', prompt);

    return sections.join('\n\n');
  }

  getInjectedNkEntries(): NegativeKnowledgeEntry[] {
    return [...this.injectedNkEntries];
  }

  clearInjectedNkEntries(): void {
    this.injectedNkEntries = [];
  }
}
