#!/usr/bin/env bash
# validate-bundle.sh — Check that a context bundle has all required files
#
# Usage:
#   bash validate-bundle.sh [output-directory]
#
# Defaults to current directory if no argument given.
# Returns exit code 0 if all required files present, 1 otherwise.
#
# Requires bash (WSL, Git Bash, or similar on Windows).

set -euo pipefail

DIR="${1:-.}"
ERRORS=0

required_files=(
  "project_profile.json"
  "docs_summary.md"
  "auth_notes.md"
  "pitfalls.md"
)

echo "=== Context Bundle Validation ==="
echo "Directory: $DIR"
echo ""

# Check required files
for f in "${required_files[@]}"; do
  if [ -f "$DIR/$f" ]; then
    size=$(wc -c < "$DIR/$f" | tr -d ' ')
    if [ "$size" -lt 50 ]; then
      echo "  WARN  $f exists but seems empty ($size bytes)"
      ERRORS=$((ERRORS + 1))
    else
      echo "  OK    $f ($size bytes)"
    fi
  else
    echo "  FAIL  $f is missing"
    ERRORS=$((ERRORS + 1))
  fi
done

# Check for probe app (any extension)
probe_found=false
for ext in py ts js sh; do
  if [ -f "$DIR/probe_app.$ext" ]; then
    echo "  OK    probe_app.$ext found"
    probe_found=true
    break
  fi
done
if [ "$probe_found" = false ]; then
  echo "  WARN  No probe_app.* found (may be expected if credentials unavailable)"
fi

# Check for .env.example
if [ -f "$DIR/.env.example" ]; then
  echo "  OK    .env.example found"
else
  echo "  WARN  .env.example not found"
fi

# Validate project_profile.json is valid JSON
if [ -f "$DIR/project_profile.json" ]; then
  if command -v python3 &>/dev/null; then
    if python3 -c "import json, sys; json.load(open(sys.argv[1]))" "$DIR/project_profile.json" 2>/dev/null; then
      echo "  OK    project_profile.json is valid JSON"
    else
      echo "  FAIL  project_profile.json is not valid JSON"
      ERRORS=$((ERRORS + 1))
    fi
  elif command -v node &>/dev/null; then
    if node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$DIR/project_profile.json" 2>/dev/null; then
      echo "  OK    project_profile.json is valid JSON"
    else
      echo "  FAIL  project_profile.json is not valid JSON"
      ERRORS=$((ERRORS + 1))
    fi
  else
    echo "  SKIP  No python3 or node available to validate JSON"
  fi
fi

echo ""
if [ "$ERRORS" -eq 0 ]; then
  echo "=== ALL CHECKS PASSED ==="
  exit 0
else
  echo "=== $ERRORS ISSUE(S) FOUND ==="
  exit 1
fi
