---
name: kamakazi
version: 0.3.0
description: >-
  Pre-flight context gathering and probe testing for complex integrations. This skill
  must be used during planning when a feature involves external APIs, SDKs, or integrating
  with other codebases. This skill should also be used standalone when a user wants to
  spike, preflight, or verify an integration before writing implementation code. Triggers
  on phrases like 'integrate with', 'connect to API', 'build against', 'spike this API',
  'figure out how to use', 'plan an integration', 'preflight', 'test this scenario',
  'kamakazi', 'probe this', or when the user names a specific API, SDK, or external
  codebase they want to work with. Also triggers during feature planning when the planned
  feature touches external services, third-party libraries, or cross-codebase boundaries.
  Can be adapted to test any complex scenario where a minimal probe would surface hidden
  issues before full implementation.
---

# Kamakazi — Pre-Flight Probe & Context Gathering

Surface everything non-obvious that affects "first attempt" success. Build a compact,
high-signal context bundle — docs + pitfalls + working probe code — before committing
to full implementation of anything complex.

## When to Use

Kamakazi operates in three modes:

### Mode 1: Planning Gate (mandatory)

During feature planning, if the planned work involves any of these, Kamakazi **must** run
before implementation begins:
- External API integration (Stripe, Twilio, OpenAI, etc.)
- SDK or third-party library with non-trivial setup
- Integrating with another codebase or service
- Cross-service auth flows (OAuth, webhooks, service accounts)

### Mode 2: Standalone Preflight (on demand)

Run independently when spiking or exploring an API/SDK without a broader plan.
Trigger phrases: "spike this API", "preflight", "figure out how to use", "probe this".

### Mode 3: Complex Scenario Testing (adaptive)

Adapt the probe workflow for any complex scenario where assumptions should be verified
before building. Examples:
- Database migration paths (test the migration on a copy first)
- Complex auth flows (verify token exchange works end-to-end)
- Third-party webhook delivery (confirm payloads arrive as documented)
- Cross-service data flows (verify serialization/deserialization roundtrips)
- Build/deploy pipeline changes (test the pipeline in isolation)

For Mode 3, adapt the workflow below: replace "API" with the scenario under test,
and adjust the probe app to verify the specific assumptions at risk.

## Probe Type Selection

Before starting the workflow, classify the task as **coding** or **non-coding**:

### Coding Probe

Use when the task involves executable API calls, SDK integration, or cross-service
data exchange. Follow the full workflow below (Steps 1-6) with a `probe_app.*` that
hits real endpoints.

### Non-Coding Probe

Use when the task involves infrastructure, CI/CD, deployment, data migration, or
architecture validation. Adapt the workflow:
- **Step 2**: Gather vendor docs, runbooks, or architecture guides instead of API docs
- **Step 4**: Create a `probe_script.sh` or `validation_report.md` instead of `probe_app.*`
- **Profile**: Use `target_systems` and `access_method` instead of `target_apis` and `auth_method`

For detailed non-coding probe patterns (Docker, CI/CD, migration, architecture),
see `references/non-coding-probes.md`.

### Scout Team Mode

When launched as part of a Kamakazi scout team after plan approval, each scout runs
this workflow independently for its assigned task. Store results in
`.claude/kamakazi-runs/[feature-name]/[task-name]/` so implementation agents can
consume the context bundles.

---

## Workflow

Follow these steps in order. Each step builds on the previous one.

### Step 1: Build the Project Profile

Extract as much as possible from what the user has already said. Only ask about what's
genuinely missing. For API integrations, the critical three are **target API/system**,
**language/framework**, and **auth method**.

Capture this profile:

| Field | Required? | Example |
|-------|-----------|---------|
| Project name | Nice to have | "invoice-sync" |
| Target system(s) | **Required** | Stripe API, Twilio SDK, internal auth service |
| Language / Framework | **Required** | Python + FastAPI, TypeScript + Next.js |
| Auth / access method | **Required** | API key, OAuth 2.0, JWT, service account, DB credentials |
| Core flows (2-4 actions) | Recommended | "create invoice", "verify webhook signature" |
| Scenario type | Infer if not stated | API integration, codebase integration, complex test |
| Platform | Infer if not stated | Web backend, CLI, serverless |
| Execution environment | Infer if not stated | Local dev, Docker |

Save the profile as `project_profile.json` in the working directory.

**Example project_profile.json** (for a TypeScript variant, see `examples/sample-project-profile.json`):

```json
{
  "project_name": "invoice-sync",
  "target_apis": [
    {"name": "Stripe", "version": "latest", "sdk": "stripe-python"}
  ],
  "language": "Python",
  "framework": "FastAPI",
  "auth_method": "API key (secret key in header)",
  "core_flows": ["create invoice", "list invoices", "send invoice"],
  "scenario_type": "api_integration",
  "platform": "web backend",
  "environment": "local dev"
}
```

### Step 2: Pull Official Documentation (Context7)

Use Context7 MCP to retrieve current, authoritative documentation for each API/SDK
in the project profile.

**Process for each library/API:**

1. Resolve the library: `Context7:resolve-library-id` with the package name
2. Query for targeted topics using `Context7:query-docs`:
   - Installation and setup
   - Authentication configuration
   - Basic usage example (hello world / quickstart)
   - Rate limiting and error codes
   - Any topic specific to the user's core flows

**CRITICAL:** Do not dump entire docs. Extract only:
- The exact setup steps (install command, init code)
- Auth configuration with a minimal working snippet
- Key constraints (rate limits, required headers, pagination patterns)
- Gotchas mentioned in the official docs themselves

Write findings to `docs_summary.md` and `auth_notes.md`.

For details on how to structure these files, see `references/output-formats.md`.

**For non-API scenarios (Mode 3):** Replace doc-pulling with gathering the relevant
technical specs, migration guides, or architecture docs for the system under test.

### Step 3: Research Real-World Pitfalls (Web Search)

Use web search to find recent, real-world issues with the target system.

**Search queries to run (adapt to the target):**
- `[system name] common errors [current year]`
- `[system name] authentication issues`
- `[system name] SDK gotchas`
- `[system name] breaking changes`
- `[system name] migration pitfalls` (for Mode 3 scenarios)

**What to extract from results:**
For each pitfall found, capture four things:
1. **Symptom** — The error message or unexpected behavior
2. **Root cause** — Why it happens (misconfig, version mismatch, permission scope, etc.)
3. **Detection** — How to spot it early
4. **Fix** — The specific resolution

Write findings to `pitfalls.md`. Prioritize issues that are non-obvious, hard to
rediscover from docs alone, and likely to hit someone on their first attempt.

Do not copy content verbatim from sources — summarize in your own words and cite sources.

### Step 4: Create the Probe App

Build the smallest possible script that proves the critical assumptions:

**For API integrations (Modes 1 & 2):**
1. Auth works end-to-end
2. At least one core endpoint responds correctly

**For complex scenarios (Mode 3):**
1. The specific assumption under test holds true
2. Error handling works as expected

**Probe app requirements:**
- Single file: `probe_app.py` (or `.ts`, `.js` depending on the project language)
- Configuration via environment variables (never hardcode credentials)
- Include a `.env.example` file showing required variables
- Clear console output: log requests, responses, status codes, and errors
- Comments explaining how to run it and what to expect

**Probe app structure pattern:**
```
1. Load config from environment
2. Initialize client / connection
3. Test auth or precondition (simplest verified request)
4. Test core operation (one representative action)
5. Print success/failure summary
```

### Step 5: Run the Probe and Iterate

Execute the probe app via the Bash tool:

1. Install dependencies (`pip install`, `npm install`, etc.)
2. Remind the user to set environment variables — if credentials aren't available,
   explain exactly what's needed and pause for the user to provide them
3. Run the probe app
4. Capture all output: status codes, error messages, stack traces

**Iterate until you achieve:**
- Successful authentication or precondition verification
- At least one successful operation

**For each failure encountered:**
- Diagnose the root cause
- Fix the probe app
- Add the issue + fix to `pitfalls.md` — these real failures are the most valuable
  part of the context bundle

**If auth credentials aren't available:** Still complete steps 1-3 fully. Create the
probe app and document exactly what credentials are needed, where to get them, and what
environment variables to set. Mark the probe as "ready to run once credentials are configured."

### Step 6: Deliver the Context Bundle

Produce these output files:

| File | Purpose |
|------|---------|
| `project_profile.json` | Project metadata and assumptions |
| `docs_summary.md` | Concise overview of official docs and key patterns |
| `auth_notes.md` | How auth works, with minimal working snippet |
| `pitfalls.md` | Concrete issues to avoid, with fixes |
| `probe_app.*` + `.env.example` | Working code demonstrating successful access |

Save all files to the output directory and present them to the user.

**In the summary, explicitly state:**
> "These files contain the context needed before building the full implementation.
> If handing this off to another agent or developer, have them read
> docs_summary.md, auth_notes.md, and pitfalls.md first."

Focus all written output on things that are non-obvious, hard to rediscover from
documentation alone, and likely to impact first-attempt success.

---

## Failure Modes and Fallbacks

| Situation | Fallback |
|-----------|----------|
| Context7 doesn't have the library | Use web search + `web_fetch` on official docs site |
| Web search returns nothing useful | Note the gap; rely on Context7 docs and probe results |
| Probe can't run (no credentials) | Deliver the bundle with probe marked "ready to run" |
| API requires OAuth flow / browser auth | Document the flow; create probe for post-auth usage |
| Multiple APIs in project | Run steps 2-5 for each API sequentially |
| Non-API scenario (Mode 3) | Adapt probe to test the specific assumption at risk |

---

## Additional Resources

### Reference Files

- **`references/output-formats.md`** — Templates and formatting guidance for all output files. Read this before writing any output files.
- **`references/non-coding-probes.md`** — Probe patterns for infrastructure, CI/CD, data migration, and architecture validation. Read this for non-coding probe tasks.

### Example Files

Working examples showing expected output in `examples/`:
- **`examples/sample-project-profile.json`** — Complete project profile for a Stripe integration
- **`examples/sample-pitfalls.md`** — Pitfalls file demonstrating the symptom/cause/fix structure

### Scripts

- **`scripts/validate-bundle.sh`** — Run after generating a context bundle to verify all required files exist and are non-empty. Usage: `bash scripts/validate-bundle.sh [output-directory]`
