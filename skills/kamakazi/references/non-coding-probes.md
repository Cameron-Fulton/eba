# Non-Coding Probe Patterns

Guidance for adapting the Kamakazi probe workflow to non-code scenarios: infrastructure,
CI/CD, data migration, architecture validation, and environment verification.

The core principle remains the same: **build the smallest possible test that proves
your critical assumptions hold**, then document what you learn.

---

## Infrastructure Probes

### Docker / Container

**What to test:**
- Image builds successfully from Dockerfile
- Container starts and passes health check
- Required ports are exposed and reachable
- Volume mounts work as expected
- Environment variables propagate correctly

**Probe approach:**
```bash
# probe_script.sh
docker build -t probe-test . 2>&1
docker run --rm -d --name probe-test -p 3000:3000 probe-test
sleep 5
curl -f http://localhost:3000/health || echo "FAIL: health check"
docker logs probe-test
docker stop probe-test
```

**Success criteria:** Image builds, container starts, health check passes.

**Common pitfalls:**
- Multi-stage builds failing on missing build args
- Node.js `sharp` library needs platform-specific binaries
- `.dockerignore` missing -> huge image with `node_modules`
- Health check timeout too short for cold start

---

### Cloud / Deployment

**What to test:**
- DNS resolution to expected IP
- TLS certificate validity and chain
- Reverse proxy forwards to correct upstream
- Environment variables available in runtime
- File system permissions for uploads/storage

**Probe approach:**
```bash
# probe_script.sh
echo "=== DNS Resolution ==="
nslookup $DOMAIN

echo "=== TLS Certificate ==="
openssl s_client -connect $DOMAIN:443 -servername $DOMAIN </dev/null 2>/dev/null | openssl x509 -noout -dates -subject

echo "=== HTTP Response ==="
curl -sI https://$DOMAIN/health

echo "=== Environment ==="
ssh $SERVER 'printenv | grep -E "^(DATABASE_URL|REDIS_URL|NODE_ENV)"'
```

**Success criteria:** DNS resolves, TLS valid, HTTP 200 on health endpoint.

---

### Networking / Connectivity

**What to test:**
- Service-to-service connectivity (can app reach database, cache, external APIs)
- Firewall rules allow required traffic
- VPN/tunnel connectivity if applicable

**Probe approach:**
```bash
# probe_script.sh
echo "=== Database Connectivity ==="
nc -zv $DB_HOST $DB_PORT 2>&1

echo "=== Redis Connectivity ==="
redis-cli -h $REDIS_HOST -p $REDIS_PORT ping

echo "=== External API Reachability ==="
curl -sI https://api.stripe.com/v1 -o /dev/null -w "%{http_code}"
```

**Success criteria:** All services reachable, expected response codes.

---

## CI/CD Probes

### Pipeline Validation

**What to test:**
- Build succeeds in pipeline environment
- Tests pass in CI container
- Artifacts generate correctly
- Deployment step config is valid (dry-run)

**Probe approach:**
```bash
# probe_script.sh — simulate CI locally
echo "=== Install Dependencies ==="
pnpm install --frozen-lockfile 2>&1

echo "=== Lint ==="
pnpm lint 2>&1

echo "=== Type Check ==="
pnpm build 2>&1

echo "=== Test ==="
pnpm test 2>&1 || echo "WARN: Tests failed"
```

**Success criteria:** Install, lint, build, and test all pass.

**Common pitfalls:**
- `pnpm-lock.yaml` out of sync -> `--frozen-lockfile` fails
- Missing environment variables in CI that exist locally
- Different Node.js version between local and CI
- Build cache invalidation causing unexpected rebuilds

---

### GitHub Actions / Workflow

**What to test:**
- Workflow YAML syntax is valid
- Action versions are current and compatible
- Secret names match what's configured in repo settings
- Conditions and triggers fire as expected

**Probe approach:**
```bash
# Validate workflow YAML
npx yaml-lint .github/workflows/*.yml

# Check action versions
grep -r "uses:" .github/workflows/ | grep -v "@v" && echo "WARN: actions without version pins"

# Verify secret references exist
grep -roh '\${{ secrets\.\w* }}' .github/workflows/ | sort -u
```

**Success criteria:** Valid YAML, all actions pinned to versions, secrets documented.

---

## Data Migration Probes

### Schema Migration

**What to test:**
- Migration runs without errors on current schema
- Rollback works cleanly
- Data integrity preserved after migration
- Performance acceptable for table size

**Probe approach:**
```bash
# probe_script.sh — test migration on a copy
echo "=== Current Schema ==="
pnpm --filter @repo/database generate 2>&1

echo "=== Migration Dry Run ==="
# For Prisma:
pnpm --filter @repo/database migrate diff --preview 2>&1

echo "=== Migration Apply (test DB) ==="
DATABASE_URL=$TEST_DB_URL pnpm --filter @repo/database migrate deploy 2>&1

echo "=== Verify Schema ==="
DATABASE_URL=$TEST_DB_URL pnpm --filter @repo/database generate 2>&1
```

**Success criteria:** Migration applies cleanly, rollback works, generated client matches.

**Common pitfalls:**
- Migration adds NOT NULL column without default -> fails on existing data
- Foreign key constraints block table alterations
- Index creation on large tables causes lock timeouts
- Prisma drift between `schema.prisma` and actual DB

---

### Data Transform / ETL

**What to test:**
- Transform logic produces expected output shape
- Edge cases handled (nulls, unicode, large values)
- Idempotent — running twice doesn't duplicate data

**Probe approach:**
Create a test dataset (10-50 rows with edge cases) and run the transform:
```bash
# probe_script.sh
echo "=== Generate Test Data ==="
node scripts/generate-test-data.js > /tmp/test-data.json

echo "=== Run Transform ==="
node scripts/transform.js < /tmp/test-data.json > /tmp/output.json 2>&1

echo "=== Validate Output ==="
node -e "
  const out = require('/tmp/output.json');
  console.log('Records:', out.length);
  console.log('Sample:', JSON.stringify(out[0], null, 2));
  console.log('Nulls:', out.filter(r => !r.id).length);
"
```

**Success criteria:** All records transform, no nulls in required fields, output matches schema.

---

## Architecture Probes

### Compatibility / Integration

**What to test:**
- Library versions are compatible with each other
- API version matches SDK version
- Runtime supports required features (Node version, browser APIs)

**Probe approach:**
```bash
# probe_script.sh
echo "=== Node Version ==="
node -v

echo "=== Package Compatibility ==="
pnpm ls --depth 0 2>&1

echo "=== Peer Dependency Check ==="
pnpm install 2>&1 | grep -i "peer dep"

echo "=== Import Test ==="
node -e "
  try { require('stripe'); console.log('OK: stripe') }
  catch(e) { console.log('FAIL: stripe -', e.message) }
"
```

**Success criteria:** No peer dependency conflicts, all imports resolve.

---

### Research Validation

For purely research-based probes (no executable test), produce a `validation_report.md`:

```markdown
# Validation Report: [Topic]

**Date:** [date]
**Scenario:** [what assumption is being validated]

## Assumption Under Test

[Clear statement of what needs to be true for the plan to work]

## Evidence For

[Documentation, examples, or references supporting the assumption]

## Evidence Against

[Counter-examples, known limitations, version-specific caveats]

## Verdict

[CONFIRMED | PARTIALLY CONFIRMED | REFUTED | INSUFFICIENT EVIDENCE]

## Recommendations

[What to do based on findings — proceed as planned, adjust approach, or gather more data]

## Sources

[URLs and references consulted]
```

**Success criteria:** Clear verdict with supporting evidence.

---

## Output File Adaptations for Non-Coding Probes

| Standard File | Non-Coding Adaptation |
|---------------|----------------------|
| `project_profile.json` | Replace `target_apis` with `target_systems`, `auth_method` with `access_method` |
| `docs_summary.md` | Vendor docs, runbooks, architecture guides instead of API reference |
| `auth_notes.md` | Access credentials, SSH keys, service accounts, IAM roles |
| `pitfalls.md` | Same structure — infrastructure footguns instead of SDK gotchas |
| `probe_app.*` | `probe_script.sh` or `validation_report.md` |
| `.env.example` | Include all env vars the probe needs (DB URLs, SSH hosts, etc.) |

---

## Non-Coding Project Profile Schema

```json
{
  "project_name": "coolify-deploy",
  "description": "Deploy Next.js app to Hetzner via Coolify",
  "target_systems": [
    {
      "name": "Coolify",
      "version": "4.x",
      "type": "PaaS",
      "docs_url": "https://coolify.io/docs"
    }
  ],
  "language": "bash",
  "access_method": "SSH + Coolify API token",
  "core_tasks": ["build Docker image", "deploy to Coolify", "configure domain"],
  "scenario_type": "infrastructure",
  "platform": "Hetzner VPS",
  "environment": "production"
}
```
