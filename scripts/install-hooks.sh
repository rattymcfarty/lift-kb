#!/bin/bash
# Point git at the versioned hooks in scripts/hooks (idempotent; safe in CI).
cd "$(dirname "$0")/.." || exit 0
[ -d .git ] || exit 0
chmod +x scripts/hooks/* scripts/secrets-scan.sh 2>/dev/null || true
git config core.hooksPath scripts/hooks
echo "git hooks installed (core.hooksPath=scripts/hooks)"
