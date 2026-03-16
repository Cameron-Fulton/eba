# Output File Formats Reference

Templates and guidelines for each file in the context bundle.

---

## project_profile.json

```json
{
  "project_name": "<name>",
  "description": "<one-line summary>",
  "target_apis": [
    {
      "name": "<API/SDK name>",
      "version": "<version or 'latest'>",
      "sdk": "<package name if using an SDK>",
      "docs_url": "<official documentation URL>"
    }
  ],
  "language": "<primary language>",
  "framework": "<framework if any>",
  "auth_method": "<API key | OAuth 2.0 | JWT | service account | etc.>",
  "core_flows": ["<action 1>", "<action 2>", "<action 3>"],
  "platform": "<web backend | CLI | SPA | mobile | serverless>",
  "environment": "<local dev | Docker | cloud>",
  "generated_at": "<ISO 8601 timestamp>",
  "context7_libraries_used": ["<library-id-1>", "<library-id-2>"]
}
```

---

## docs_summary.md

```markdown
# Documentation Summary: [API Name]

**Generated:** [date]
**Source:** Context7 library [library-id] + official docs at [URL]

## Setup

[Exact install command]
[Minimal initialization code — 5-10 lines max]

## Authentication

[How auth works in one paragraph]
[Minimal working auth snippet]

## Key API Patterns

[For each core flow the user needs:]

### [Flow Name] (e.g., "Create Invoice")

[Minimal code example — what the request looks like, what the response contains]
[Key parameters and their constraints]

## Rate Limits and Constraints

[Rate limit numbers]
[Pagination approach]
[Required headers beyond auth]
[Payload size limits if relevant]

## Important Notes from Official Docs

[Anything the docs call out as a common mistake or required step]
[Deprecation notices affecting the user's use case]
```

**Guidelines:**
- Keep under 200 lines per API
- Include code snippets, not prose descriptions of code
- Every snippet must be copy-pasteable and syntactically correct
- Cite which Context7 library or doc page each piece came from

---

## auth_notes.md

```markdown
# Authentication Notes: [API Name]

## Method

[Auth type: API key / OAuth 2.0 / JWT / etc.]

## Required Credentials

| Credential | Where to Get It | Environment Variable |
|-----------|-----------------|---------------------|
| [e.g., Secret Key] | [e.g., Dashboard > API Keys] | [e.g., STRIPE_SECRET_KEY] |

## Minimal Working Auth Example

[Complete, runnable code block that authenticates and makes one request]
[This should be 10-20 lines max, fully self-contained]

## Auth Gotchas

[Anything non-obvious about auth for this API:]
- [e.g., "Test keys start with sk_test_, live keys with sk_live_"]
- [e.g., "OAuth tokens expire after 1 hour, refresh tokens after 30 days"]
- [e.g., "API key must be in Authorization header, not query param"]

## Scopes / Permissions Required

[For OAuth/service accounts: minimum scopes needed for the user's core flows]
```

**Guidelines:**
- This file is the single source of truth for "how do I auth against this API"
- The minimal working example must actually work if credentials are provided
- Be explicit about test vs. production credentials

---

## pitfalls.md

```markdown
# Known Pitfalls: [API Name]

**Generated:** [date]
**Sources:** Web research, probe app testing, official documentation

## From Documentation

[Pitfalls explicitly mentioned in official docs]

### [Pitfall Title]

- **Symptom:** [What you see when this goes wrong]
- **Root Cause:** [Why it happens]
- **Detection:** [How to spot it early]
- **Fix:** [Specific resolution]

## From Web Research

[Pitfalls found via web search — StackOverflow, GitHub issues, blog posts]

### [Pitfall Title]

- **Symptom:** [Error message or behavior]
- **Root Cause:** [e.g., "SDK v3 changed the import path"]
- **Detection:** [e.g., "ImportError on first run"]
- **Fix:** [e.g., "Use `from stripe import Stripe` not `import stripe`"]
- **Source:** [URL where this was found]

## From Probe App Testing

[Pitfalls discovered during actual probe execution — these are the most valuable]

### [Pitfall Title]

- **Symptom:** [Exact error message from probe run]
- **Root Cause:** [What was actually wrong]
- **Fix:** [What changed in the probe app to resolve it]
```

**Guidelines:**
- Prioritize pitfalls by likelihood of hitting them on first attempt
- Include exact error messages when available — they're searchable
- The "From Probe App Testing" section is often the most valuable; these are real
  issues the user would have hit
- Keep each pitfall to 4-6 lines max

---

## probe_app.* (Python example)

```python
#!/usr/bin/env python3
"""
Probe app for [API Name]
Tests authentication and core endpoint access.

Setup:
  1. pip install [packages]
  2. Copy .env.example to .env and fill in credentials
  3. python probe_app.py

Expected output:
  - Auth test: OK/FAIL with status code
  - [Endpoint] test: OK/FAIL with response summary
"""

import os
import sys

# Load environment
from dotenv import load_dotenv
load_dotenv()

def check_env(var_name: str) -> str:
    """Get required environment variable or exit with clear message."""
    value = os.getenv(var_name)
    if not value:
        print(f"ERROR: {var_name} not set. See .env.example for required variables.")
        sys.exit(1)
    return value

def test_auth():
    """Test that authentication works."""
    # [Auth test implementation]
    pass

def test_core_endpoint():
    """Test a representative API call."""
    # [Core endpoint test implementation]
    pass

def main():
    print("=" * 50)
    print("[API Name] Probe App")
    print("=" * 50)

    # Check required env vars
    api_key = check_env("API_KEY_VAR_NAME")

    # Test auth
    print("\n[1/2] Testing authentication...")
    auth_ok = test_auth()
    print(f"  Auth: {'OK' if auth_ok else 'FAIL'}")

    # Test core endpoint
    print("\n[2/2] Testing [endpoint name]...")
    endpoint_ok = test_core_endpoint()
    print(f"  [Endpoint]: {'OK' if endpoint_ok else 'FAIL'}")

    # Summary
    print("\n" + "=" * 50)
    if auth_ok and endpoint_ok:
        print("ALL TESTS PASSED — API is accessible and auth works.")
    else:
        print("SOME TESTS FAILED — see output above for details.")
    print("=" * 50)

if __name__ == "__main__":
    main()
```

**Guidelines:**
- Adapt this pattern to the project language (Python, TypeScript, etc.)
- Always use environment variables for credentials
- Print clear pass/fail for each test
- Include the full error response body on failure — it helps diagnosis
- Keep it under 100 lines if possible

---

## .env.example

```bash
# Required credentials for [API Name] probe app
# Get these from: [where to get them]

API_KEY_VAR_NAME=your_api_key_here
# OAUTH_CLIENT_ID=your_client_id_here  # (if OAuth)
# OAUTH_CLIENT_SECRET=your_secret_here  # (if OAuth)
```

**Guidelines:**
- Never include real credentials
- Comment each variable with where to obtain it
- Include only variables the probe app actually uses
