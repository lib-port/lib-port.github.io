#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$repo_root"
bundle exec ruby scripts/validate_site_config.rb
bundle exec jekyll build -d ./_site
if [[ "${JEKYLL_ENV:-development}" == "production" ]]; then
  node scripts/optimise_assets.mjs ./_site
fi
