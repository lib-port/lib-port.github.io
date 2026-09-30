#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_dir"

if ! command -v ruby >/dev/null 2>&1 ||
  ! ruby -e 'major, minor = RUBY_VERSION.split(".").map(&:to_i); exit(major > 3 || (major == 3 && minor >= 3) ? 0 : 1)' >/dev/null 2>&1; then
  printf 'Ruby 3.3 or newer is required. See README.md for setup.\n' >&2
  exit 1
fi

if ! command -v bundle >/dev/null 2>&1; then
  printf 'Bundler is required. See README.md for setup.\n' >&2
  exit 1
fi

if ! bundle check >/dev/null 2>&1; then
  printf 'Ruby dependencies are not installed. Run "bundle install".\n' >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1 ||
  ! python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; then
  printf 'Python 3.11 or newer is required. See README.md for setup.\n' >&2
  exit 1
fi

if ! python3 -c 'import yaml' >/dev/null 2>&1; then
  printf 'Python dependencies are not installed. Run "python3 -m pip install -r requirements.txt".\n' >&2
  exit 1
fi

python3 scripts/validate_site_config.py

if [[ -z "${JEKYLL_GITHUB_TOKEN:-}" ]]; then
  github_token=""
  if command -v gh >/dev/null 2>&1 &&
    github_token="$(gh auth token --hostname github.com 2>/dev/null)" &&
    [[ -n "$github_token" ]]; then
    export JEKYLL_GITHUB_TOKEN="$github_token"
  else
    printf 'GitHub authentication is required. Set JEKYLL_GITHUB_TOKEN or run "gh auth login --hostname github.com".\n' >&2
    exit 1
  fi
fi

exec bundle exec jekyll serve --livereload --open-url "$@"
