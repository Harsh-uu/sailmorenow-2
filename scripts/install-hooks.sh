#!/usr/bin/env bash
# Installs the repo git hooks locally. Run once after cloning:
#   bash scripts/install-hooks.sh
set -e
ROOT="$(git rev-parse --show-toplevel)"
cp "$ROOT/scripts/hooks/pre-commit" "$ROOT/.git/hooks/pre-commit"
chmod +x "$ROOT/.git/hooks/pre-commit"
echo "Installed pre-commit hook (docs/ICONS.md freshness check)."
