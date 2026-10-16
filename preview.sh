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

bundle exec ruby scripts/validate_site_config.rb

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

exec bundle exec ruby scripts/preview_site.rb serve --livereload --open-url "$@"
