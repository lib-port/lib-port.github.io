#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$repo_root"
python3 scripts/validate_site_config.py
bundle exec jekyll build -d ./_site
