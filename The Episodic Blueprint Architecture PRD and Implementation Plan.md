Here is the Product Requirements Document (PRD) and Implementation Plan to build the **Episodic Blueprint Architecture (EBA)**, synthesizing the best practices from the provided research on agentic engineering, memory compression, and system safety.

# **Product Requirements Document (PRD): Episodic Blueprint Architecture (EBA)**

## **1\. Executive Summary**

**Vision:** To build an enterprise-grade, highly autonomous AI engineering system that solves the three compounding problems of AI agents: context rot, infinite loops, and hallucination 1, 2\.**Methodology:** EBA moves away from chaotic "agent swarms" chatting with each other. Instead, it treats the LLM like an Operating System kernel 3\. It interleaves deterministic code with AI reasoning (Blueprints) 4, isolates tasks into stateless worker processes that return compressed summaries (Episodic Thread Weaving) 5, 6, manages state strictly through external flat files (Hybrid Memory) 7, and ensures reliability through multi-model voting and visual proof 8, 9\.

## **2\. Core Architecture & Requirements**

### **Layer 1: Hybrid Memory & Context Engine**

*The "No Amnesia" Brain. Externalizes state to prevent context rot.*

* **Markdown-Canonical Storage:** The system will use Markdown files (e.g., MEMORY.md, PROJECT.md) as the canonical source of truth for all agent state and project rules, as Markdown is highly token-efficient and natively understood by LLMs 7, 10\.  
* **Derived Indexing:** A local SQLite database will serve strictly as a fast retrieval index (Vector \+ BM25) that is constantly rebuilt from the Markdown files 7\.  
* **Structured Solution Storage (Negative Knowledge):** To prevent agents from repeating mistakes, failures will be logged in a strict Scenario \-\> Attempt \-\> Solution format 11, 12\. Agents must query this "Negative Knowledge" before beginning a task 13, 14\.  
* **Memory Packets:** Session handoffs will be compressed into strict JSON Memory Packets (achieving \~97% fidelity with 20:1 token compression) 15, 16\. Packets must explicitly capture decisions, rejected ideas, risks, and open\_threads 17, 18\.

### **Layer 2: The Blueprint Orchestrator**

*The combination of Deterministic Code and AI.*

* **AI Developer Workflows (Blueprints):** The orchestrator is a deterministic script (e.g., Python/Node). It will handle all linters, formatting, and test executions natively. It will only invoke the LLM for reasoning and code generation steps 4, 19\.  
* **Standard Operating Procedures (SOPs):** Agents will be guided by natural language pseudocode modeled as decision graphs 20\. Based on the agent's current step in the SOP, the orchestrator will dynamically restrict its accessible tools to eliminate hallucinations 21, 22\.  
* **The Ralph Wiggum Loop:** Memory does not live in the AI's context window; it lives in the files 23\. The orchestrator will routinely terminate the agent process upon task completion or context saturation and spin up a fresh agent that reads the external Markdown files to orient itself 23, 24\.

### **Layer 3: Episodic Thread Weaving**

*The OS-style Execution Layer.*

* **Thread Isolation:** Instead of multi-agent chat, the orchestrator dispatches a "Thread" (a sub-agent) to complete a single action in total isolation 5, 25\.  
* **Episodic Returns:** Threads do not use back-and-forth message passing with the orchestrator. Upon completion, the thread returns an "Episode"—a highly compressed representation of its results without the bloated tactical trace 6\.  
* **The Tool Shed (Meta-Agentics):** To avoid token explosion from loading hundreds of tools, a lightweight routing agent will first search a "Tool Shed" (an internal Model Context Protocol server) to select only the 2-3 specific tools required for the episode, loading only those schemas into the worker thread's prompt 26, 27\.

### **Layer 4: Validation & Safety**

*Safety constraints and proof of work.*

* **Consortium Consistency:** For complex logic, the orchestrator will query a consortium of diverse models (e.g., Claude, GPT-4, Gemini) simultaneously, cluster their outputs by semantic meaning, and proceed with the majority vote to mathematically reduce hallucinations 9, 28\.  
* **Visual Proof Stop Hooks:** Passing unit tests is not enough. The orchestrator will trigger post-task hooks using tools like **Showboat** and **Rodney** (CLI browser automation) 8\. The agent must autonomously drive a headless browser, interact with the newly built feature, and generate a Markdown document with screenshots proving the code works 29-31.  
* **Three-Pillar Model (3PM) Thresholds:** The system will enforce Transparency (logging states), Accountability (decision journals), and Trustworthiness (dynamic risk thresholds) 32, 33\. If an agent attempts a high-risk action (e.g., database modification), the orchestrator suspends the thread and pings a human via Slack/UI for approval 34, 35\.

# **Implementation Plan**

We will build the Episodic Blueprint Architecture in four distinct phases to ensure stability and progressive validation.

### **Phase 1: Foundation (Memory & Orchestrator Baseline)**

**Goal:** Establish the deterministic script and the external state environment.

* **Repository Structure:** Set up the flat /docs folder for Markdown files (PROJECT.md, ACTIVE\_TASK.md, /logs) and the hidden /.ai\_index for the SQLite-derived database 7\.  
* **Implement Memory Packets:** Build the JSON schema for memory\_packet.json to handle context serialization 16\. Build the Compression Agent to summarize chat transcripts into packets at the end of a session 36\.  
* **Build the Basic Blueprint:** Create the core Python/Node orchestrator script that can:  
* Read the active task.  
* Spin up an LLM call.  
* Run a deterministic local test (e.g., npm run test).  
* Implement the "Ralph Wiggum" kill-and-restart loop if tests fail or complete 23, 24\.

### **Phase 2: Execution Engine (Threads & Tools)**

**Goal:** Isolate reasoning into threads and manage tools efficiently.

1. **Implement Slate-Style Threads:** Refactor the orchestrator so it no longer loops a single agent. Instead, it dispatches isolated worker threads that execute a single prompt and return a compressed "Episode" 5, 6\.  
2. **Build the Tool Shed:** Centralize all tools (file editing, bash, GitHub API) into an MCP server. Create a lightweight "Tool Selector" prompt that runs before the worker thread to inject only necessary tools 26\.  
3. **SOP Integration:** Write your first natural language SOP (e.g., a data cleaning or standard refactoring workflow) and map it to the orchestrator so tool access is conditionally filtered based on the active step 20, 22\.

### **Phase 3: Validation & Safety (Hooks & 3PM)**

**Goal:** Guarantee code quality and prevent autonomous disasters.

1. **Integrate Rodney/Showboat:** Add the Rodney Go library / CLI to your environment. Write a "Stop Hook" in the orchestrator that fires when code passes local tests, requiring the agent to generate a visual demo.md with screenshots 8, 30\.  
2. **Build the Consortium Voter:** Implement a parallel-processing script that sends high-complexity prompts to three different API endpoints (OpenAI, Anthropic, Google) and evaluates the consensus 9\.  
3. **Implement 3PM Risk Thresholds:** Add rules to the orchestrator that pause execution and send a webhook to a human if a worker thread attempts to touch restricted directories or deploy code 34, 35\.

### **Phase 4: Auto-Research & Scale**

**Goal:** Turn the task-finishing system into an infinite optimization engine.

1. **The Arena Loop:** Point the orchestrator at a specific benchmark or objective metric (e.g., reducing validation loss, improving UI load times) 37, 38\.  
2. **Continuous Evolution:** Allow the system to run 100x overnight. Because of Phase 1's Negative Knowledge storage, parallel threads will check the database, realize Agent A already failed a specific approach, and autonomously attempt a different path without wasting compute 13, 39\.

